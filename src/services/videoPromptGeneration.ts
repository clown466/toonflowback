import u from "@/utils";

export type VideoPromptLanguage = "english" | "chinese";
export type VideoPromptSource = "storyboard" | "assets" | "directorBoard";

export interface VideoPromptInfoItem {
  id: number;
  sources: VideoPromptSource;
}

export interface GenerateVideoPromptInput {
  trackId: number;
  projectId: number;
  info: VideoPromptInfoItem[];
  model: string;
  duration?: number;
}

function parseNumberArray(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number).filter((item) => Number.isFinite(item));
  try {
    const parsed = JSON.parse(String(value || "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed.map(Number).filter((item) => Number.isFinite(item));
  } catch {
    return [];
  }
}

function countCjk(text: string) {
  return text.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0;
}

function countLatinLetters(text: string) {
  return text.match(/[A-Za-z]/g)?.length ?? 0;
}

function detectVideoPromptLanguage(input: {
  projectData: any;
  scriptData?: any;
  storyboard: any[];
  directorBoards: any[];
}): VideoPromptLanguage {
  const intentText = [input.projectData?.type, input.projectData?.intro, input.projectData?.directorManual].filter(Boolean).join("\n");
  const hasEnglishIntent = /\b(english|american\s+(short\s+)?drama|us\s+(short\s+)?drama|english-language)\b|英文|英语|美剧/i.test(intentText);
  const hasChineseIntent = /\b(chinese|mandarin|chinese-language)\b|中文|汉语|普通话/i.test(intentText);
  if (hasEnglishIntent && !hasChineseIntent) return "english";
  if (hasChineseIntent && !hasEnglishIntent) return "chinese";

  const sourceText = [
    input.scriptData?.name,
    input.scriptData?.content,
    ...input.storyboard.flatMap((item) => [item.videoDesc, item.prompt]),
    ...input.directorBoards.map((item) => item.prompt),
  ]
    .filter(Boolean)
    .join("\n");
  const cjkChars = countCjk(sourceText);
  const latinLetters = countLatinLetters(sourceText);
  return latinLetters > cjkChars * 2 ? "english" : "chinese";
}

function buildVideoPromptLanguageSystemRule(language: VideoPromptLanguage) {
  if (language === "english") {
    return [
      "**Video prompt output language override (highest priority)**:",
      "The final video prompt must be English only, except fixed reference labels such as @图1, character names, asset names, and original dialogue that is intentionally quoted.",
      "Use `Shot 1:`, `Shot 2:` for shot sections. Do not output Chinese section names such as `镜头`, `分镜`, `场景`, `参考定义`, or mixed Chinese-English prose.",
      "If the base skill says a specific model should use Chinese, this project-level language rule overrides it for English-language projects.",
    ].join("\n");
  }
  return [
    "**视频提示词输出语言规则（最高优先级）**：",
    "最终视频提示词使用中文，可保留 @图1 等固定引用标签、角色名、资产名和原始台词。",
    "不要中英混杂；除角色名、模型名、资产名、原始台词外，正文统一中文。",
  ].join("\n");
}

function sumStoryboardDuration(storyboard: any[]) {
  return storyboard.reduce((sum, item) => {
    const value = Number(String(item.duration ?? "").replace(/[^\d.]/g, ""));
    return sum + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);
}

function chooseTargetDuration(input: { requestedDuration?: unknown; storyboard: any[]; hasDirectorBoard: boolean }) {
  const storyboardDuration = sumStoryboardDuration(input.storyboard);
  const requestedDuration = Number(input.requestedDuration);
  if (input.hasDirectorBoard && storyboardDuration > 0) return storyboardDuration;
  if (Number.isFinite(requestedDuration) && requestedDuration > 0) return requestedDuration;
  return storyboardDuration;
}

async function loadStoryboardsWithAssets(storyboardIds: number[], projectId: number, scriptId: number) {
  const ids = Array.from(new Set(storyboardIds.map(Number).filter((id) => Number.isFinite(id))));
  if (!ids.length) return [];

  const rows = await u
    .db("o_storyboard")
    .where({ projectId, scriptId })
    .whereIn("id", ids)
    .select("id", "index", "videoDesc", "prompt", "track", "duration", "shouldGenerateImage");
  const assetRows = await u.db("o_assets2Storyboard").whereIn("storyboardId", ids).orderBy("rowid").select("storyboardId", "assetId");
  const assetMap = new Map<number, number[]>();
  assetRows.forEach((row: any) => {
    const storyboardId = Number(row.storyboardId);
    const assetId = Number(row.assetId);
    if (!Number.isFinite(storyboardId) || !Number.isFinite(assetId)) return;
    const current = assetMap.get(storyboardId) ?? [];
    current.push(assetId);
    assetMap.set(storyboardId, current);
  });

  const rowMap = new Map(rows.map((row: any) => [Number(row.id), row]));
  return ids
    .map((id) => rowMap.get(id))
    .filter(Boolean)
    .map((row: any) => ({
      id: row.id,
      index: row.index,
      videoDesc: row.videoDesc,
      prompt: row.prompt,
      track: row.track,
      duration: row.duration,
      associateAssetsIds: assetMap.get(Number(row.id)) ?? [],
      shouldGenerateImage: 0,
    }));
}

function buildDirectorBoardVideoPromptRules(hasDirectorBoard: boolean) {
  if (!hasDirectorBoard) return "";
  return [
    "**章节导演板视频提示词输出规则（最高优先级）**：",
    "1. 存在章节导演板参考时，输出必须按镜头拆分，禁止合并成一整段连续描述。",
    "2. 每个 <storyboardItem> 至少对应一个独立镜头段落，使用类似 `镜头1：`、`镜头2：` 的清晰编号；如果源项目/对白为英文，可使用 `Shot 1:`、`Shot 2:`，但不要中英混杂。",
    "3. 每个镜头段落必须包含：时长、导演板参考作用、角色/资产参考、景别、运镜、角色动作、空间站位/运动方向、光影氛围、台词/无台词、音效。",
    "4. 章节导演板只作为空间、机位、角色站位、动作方向、场景连续性的第一参考；角色最终外观、脸、服装、身体材质、比例、武器细节以资产参考图为最高优先级。",
    "5. 导演板中的铅笔线稿、符号角色或简化角色不可当作最终角色长相参考；不要让导演板里可能不准确的角色形象覆盖资产图。",
    "6. 单次视频片段总时长必须服从当前视频生成参数中的目标时长；如果存在章节导演板，目标时长等于该导演板覆盖分镜的 duration 总和。",
    "7. 如果章节导演板覆盖了多个分镜，每个 <storyboardItem> 代表一个镜头/子镜头，不允许因为只选择了导演板参考图就输出 0 个分镜。",
    "8. 自动从章节导演板补入的 <storyboardItem> 只提供文字镜头上下文，不是额外上传的分镜图片；当 shouldGenerateImage=false 时，禁止给它分配新的 @图N 或写成 storyboard image reference。",
    "9. 输出只给可直接发送给视频模型的视频提示词，不要解释规则，不要输出 XML，不要输出分析过程。",
    "",
    "推荐输出结构：",
    "参考优先级：资产参考图 > 章节导演板空间/机位/连续性 > 分镜文字。",
    "总片段：{总时长}s，按导演板覆盖范围生成。",
    "镜头1：{时长}，{景别/机位/运镜}，{角色与站位}，{动作}，{光影/场景连续性}，{台词或无台词}，{音效}。",
    "镜头2：{时长}，{景别/机位/运镜}，{角色与站位}，{动作}，{光影/场景连续性}，{台词或无台词}，{音效}。",
  ].join("\n");
}

export async function generateVideoPromptForTrack(input: GenerateVideoPromptInput) {
  const { trackId, projectId, info, model, duration } = input;
  const videoTrackData = await u.db("o_videoTrack").where({ id: trackId, projectId }).select("scriptId").first();
  const scriptId = Number(videoTrackData?.scriptId);
  if (!Number.isInteger(scriptId) || scriptId <= 0) throw new Error("视频轨道不存在或未绑定章节工作区，无法生成视频提示词。");
  const scriptData = await u.db("o_script").where({ id: scriptId, projectId }).select("name", "content").first();
  const images = await Promise.all(
    info.map(async (item) => {
      if (item.sources === "storyboard") {
        const storyboard = await u
          .db("o_storyboard")
          .where("o_storyboard.id", item.id)
          .where({ projectId, scriptId })
          .select("id", "index", "videoDesc", "prompt", "track", "duration", "shouldGenerateImage")
          .first();
        if (!storyboard) return undefined;
        const assetRows = await u.db("o_assets2Storyboard").where("storyboardId", item.id).orderBy("rowid").select("assetId");
        const associateAssetsIds = assetRows.map((row: any) => row.assetId);
        return {
          ...storyboard,
          associateAssetsIds,
          _type: "storyboard",
        };
      }
      if (item.sources === "assets") {
        const assetsData = await u
          .db("o_assets")
          .leftJoin("o_image", "o_image.id", "o_assets.imageId")
          .where("o_assets.id", item.id)
          .where("o_assets.projectId", projectId)
          .select("o_assets.id", "o_assets.type", "o_assets.name", "o_image.filePath")
          .first();
        if (!assetsData) return undefined;
        return {
          ...assetsData,
          _type: "assets",
        };
      }
      if (item.sources === "directorBoard") {
        const board = await u
          .db("o_directorBoard")
          .where({ id: item.id, projectId, scriptId })
          .select("id", "name", "prompt", "filePath", "storyboardIds", "assetIds", "boardType")
          .first();
        if (!board) return undefined;
        return {
          ...board,
          _type: "directorBoard",
        };
      }
      return undefined;
    }),
  );

  const assets: any[] = [];
  const storyboard: any[] = [];
  const directorBoards: any[] = [];
  for (const item of images) {
    if (!item) continue;
    if (item._type === "assets")
      assets.push({
        id: item.id,
        type: item.type,
        name: item.name,
        filePath: item.filePath,
      });
    if (item._type === "storyboard")
      storyboard.push({
        id: item.id,
        index: item.index,
        videoDesc: item.videoDesc,
        prompt: item.prompt,
        track: item.track,
        duration: item.duration,
        associateAssetsIds: item.associateAssetsIds,
        shouldGenerateImage: item.shouldGenerateImage,
      });
    if (item._type === "directorBoard")
      directorBoards.push({
        id: item.id,
        name: item.name,
        prompt: item.prompt,
        filePath: item.filePath,
        storyboardIds: item.storyboardIds,
        assetIds: item.assetIds,
        boardType: item.boardType,
      });
  }

  const selectedStoryboardIds = new Set(storyboard.map((item) => Number(item.id)).filter((id) => Number.isFinite(id)));
  const directorBoardStoryboardIds = directorBoards
    .flatMap((board) => parseNumberArray(board.storyboardIds))
    .filter((id) => !selectedStoryboardIds.has(id));
  if (directorBoardStoryboardIds.length) {
    storyboard.push(...(await loadStoryboardsWithAssets(directorBoardStoryboardIds, projectId, scriptId)));
    storyboard.sort((a, b) => {
      const aIndex = Number(a.index ?? Number.MAX_SAFE_INTEGER);
      const bIndex = Number(b.index ?? Number.MAX_SAFE_INTEGER);
      if (aIndex !== bIndex) return aIndex - bIndex;
      return Number(a.id ?? 0) - Number(b.id ?? 0);
    });
  }

  const [, modelData] = model.split(/:(.+)/);
  const projectData = await u.db("o_project").select("*").where({ id: projectId }).first();
  const videoPrompt = await u.db("o_prompt").where("type", "videoPromptGeneration").first();
  const videoPromptGeneration = videoPrompt?.useData || videoPrompt?.data || undefined;
  const artStyle = projectData?.artStyle || "无";
  const visualManual = u.getArtPrompt(artStyle, "art_skills", "art_storyboard_video");
  const directorBoardVideoPromptRules = buildDirectorBoardVideoPromptRules(directorBoards.some((i) => i.filePath));
  const outputLanguage = detectVideoPromptLanguage({ projectData, scriptData, storyboard, directorBoards });
  const languageSystemRule = buildVideoPromptLanguageSystemRule(outputLanguage);
  const targetDuration = chooseTargetDuration({ requestedDuration: duration, storyboard, hasDirectorBoard: directorBoards.length > 0 });
  const content = `
          **模型名称**：${modelData || model},
          **视频生成参数**：目标时长=${targetDuration > 0 ? `${targetDuration}s` : "未指定"}，输出语言=${outputLanguage === "english" ? "English only" : "中文"}。
          **资产信息**（角色、场景、道具):${assets
        .filter((i) => i.filePath)
        .map((i) => `[${i.id},${i.type},${i.name}]`)
        .join("，")},
          **章节导演板参考**：${directorBoards
        .filter((i) => i.filePath)
        .map((i) => `[${i.id},directorBoard,${i.name || "章节导演板"},类型=${i.boardType || "continuity"},覆盖分镜=${i.storyboardIds || "[]"}]`)
        .join("，")},
          **导演板使用规则**：如果存在章节导演板参考，默认把它作为空间、机位、角色站位、动作方向、场景连续性的第一参考；但角色最终外观、脸、服装、身体材质、比例和武器细节必须以资产参考图为最高优先级。导演板中的铅笔线稿、符号角色或简化角色只表达位置、朝向、动作和情绪，不可当作角色长相参考；不要让导演板里可能不准确的角色形象覆盖资产图。分镜图只作为更细的单镜首帧补充，不要让单镜首帧推翻导演板的空间连续性。
          ${directorBoardVideoPromptRules}
          **本次实际分镜数量**：${storyboard.length}
          **分镜信息**：${storyboard.map(
          (i) => `<storyboardItem
  id='${i.id ?? ""}'
  index='${i.index ?? ""}'
  videoDesc='${i.videoDesc}'
  duration='${i.duration}'
  prompt='${(i.prompt || "").replace(/'/g, "\\'")}'
  track='${i.track}'
  associateAssetsIds='${JSON.stringify(i.associateAssetsIds || [])}'
  shouldGenerateImage='${i.shouldGenerateImage !== false && i.shouldGenerateImage !== 0 ? "true" : "false"}'
></storyboardItem>`,
        )},
          `;

  const { text } = await u.Ai.Text("universalAi").invoke({
    system: [videoPromptGeneration, languageSystemRule].filter(Boolean).join("\n\n"),
    messages: [
      {
        role: "assistant",
        content: `${visualManual}`,
      },
      {
        role: "user",
        content,
      },
    ],
  });
  await u.db("o_videoTrack").where({ id: trackId }).update({
    prompt: text,
    duration: targetDuration > 0 ? targetDuration : duration,
  });
  return {
    trackId,
    prompt: text,
    targetDuration,
    outputLanguage,
    referenceCount: info.length,
    storyboardCount: storyboard.length,
    directorBoardCount: directorBoards.length,
    assetCount: assets.length,
  };
}
