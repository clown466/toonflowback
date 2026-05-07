import u from "@/utils";
import { stripThink } from "@/utils/stripThink";
import { v4 as uuidv4 } from "uuid";

interface ProjectRow {
  id: number;
  name?: string | null;
  intro?: string | null;
  type?: string | null;
  artStyle?: string | null;
  directorManual?: string | null;
  videoRatio?: string | null;
  imageModel?: string | null;
  imageQuality?: string | null;
}

interface ScriptRow {
  id: number;
  name?: string | null;
  content?: string | null;
}

interface StoryboardRow {
  id: number;
  index?: number | null;
  prompt?: string | null;
  videoDesc?: string | null;
  duration?: string | null;
  filePath?: string | null;
  trackId?: number | null;
}

interface AssetRow {
  id: number;
  name?: string | null;
  type?: string | null;
  describe?: string | null;
  prompt?: string | null;
  filePath?: string | null;
  roleFacts?: string | null;
  negativeRoleFacts?: string | null;
}

interface DirectorBoardRow {
  id: number;
  projectId: number;
  scriptId: number;
  name?: string | null;
  prompt?: string | null;
  filePath?: string | null;
  flowId?: number | null;
  state?: string | null;
  reason?: string | null;
  model?: string | null;
  storyboardIds?: string | null;
  assetIds?: string | null;
  index?: number | null;
}

interface RoleFactCardRow {
  assetId?: number | null;
  roleName?: string | null;
  facts?: string | null;
  negativeFacts?: string | null;
}

export interface QueueDirectorBoardOptions {
  storyboardIds?: number[];
  model?: string;
  shotsPerBoard?: number;
  replace?: boolean;
  generateImages?: boolean;
}

export interface RegenerateDirectorBoardOptions {
  model?: string;
}

export type DirectorBoardPromptLanguage = "english" | "chinese";

const MAX_DIRECTOR_BOARD_DURATION_SECONDS = 15;

function compact(value: unknown, maxLength = 800) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}...`;
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function countCjk(text: string) {
  return text.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0;
}

function countLatinLetters(text: string) {
  return text.match(/[A-Za-z]/g)?.length ?? 0;
}

function inferLanguageFromText(text: string): DirectorBoardPromptLanguage | null {
  const cjkChars = countCjk(text);
  const latinLetters = countLatinLetters(text);
  if (cjkChars + latinLetters < 8) return null;
  return latinLetters > cjkChars * 2 ? "english" : "chinese";
}

function hasEnglishProductionIntent(text: string) {
  return /\b(english|american\s+(short\s+)?drama|us\s+(short\s+)?drama|english-language)\b|英文|英语|美剧/i.test(text);
}

function hasChineseProductionIntent(text: string) {
  return /\b(chinese|mandarin|chinese-language)\b|中文|汉语|普通话/i.test(text);
}

export function detectDirectorBoardPromptLanguage(input: {
  project: ProjectRow;
  script: ScriptRow;
  storyboards: StoryboardRow[];
}): DirectorBoardPromptLanguage {
  const intentText = clean([input.project.type, input.project.intro, input.project.directorManual].filter(Boolean).join("\n"));
  const englishIntent = hasEnglishProductionIntent(intentText);
  const chineseIntent = hasChineseProductionIntent(intentText);
  if (englishIntent && !chineseIntent) return "english";
  if (chineseIntent && !englishIntent) return "chinese";

  const primaryText = clean(
    [
      input.script.content,
      ...input.storyboards.flatMap((shot) => [shot.videoDesc, shot.prompt]),
    ]
      .filter(Boolean)
      .join("\n"),
  );
  const primaryLanguage = inferLanguageFromText(primaryText);
  if (primaryLanguage) return primaryLanguage;

  const fallbackLanguage = inferLanguageFromText(clean([input.script.name, input.project.name, intentText].filter(Boolean).join("\n")));
  return fallbackLanguage || "english";
}

function shouldNormalizePromptLanguage(prompt: string, language: DirectorBoardPromptLanguage) {
  const cjkChars = countCjk(prompt);
  const latinLetters = countLatinLetters(prompt);
  if (language === "english") return cjkChars >= 3;
  return latinLetters > Math.max(120, cjkChars * 0.35);
}

function unwrapPromptText(value: string) {
  const text = stripThink(value).trim();
  const fenced = text.match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/);
  return (fenced ? fenced[1] : text).trim();
}

export async function normalizeDirectorBoardPromptLanguage(prompt: string, language: DirectorBoardPromptLanguage) {
  if (!shouldNormalizePromptLanguage(prompt, language)) return prompt;

  const system =
    language === "english"
      ? [
          "You are a prompt localization assistant for AI image generation.",
          "Rewrite the user's full director-board image prompt in English only.",
          "Translate Chinese source notes, role facts, scene facts, and storyboard descriptions into concise natural English.",
          "Preserve all project names, character names, C-number labels, shot numbers, ids, time ranges, model constraints, and negative constraints.",
          "Do not summarize, omit, add commentary, or wrap the result in markdown. Output only the rewritten prompt.",
        ].join("\n")
      : [
          "你是 AI 生图提示词本地化助手。",
          "请把用户提供的整份导演板生图提示词改写成中文提示词。",
          "将英文来源说明、角色事实、场景事实和分镜描述翻译成简洁自然的中文。",
          "保留项目名、角色名、C编号、镜头编号、id、时间范围、模型约束和负面约束，不要改变含义。",
          "不要总结，不要省略，不要添加解释，不要使用 markdown 包裹，只输出改写后的提示词。",
        ].join("\n");

  const { text } = await u.Ai.Text("universalAi").invoke({
    system,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });
  return unwrapPromptText(text || "") || prompt;
}

function parseDuration(value: unknown) {
  const duration = Number(String(value ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(duration) && duration > 0 ? duration : 4;
}

export function chunkStoryboardsForDirectorBoards(
  storyboards: StoryboardRow[],
  options: {
    maxDuration?: number;
    maxShots?: number;
  } = {},
) {
  const maxDuration = Math.max(1, Number(options.maxDuration || MAX_DIRECTOR_BOARD_DURATION_SECONDS));
  const maxShots = Math.max(1, Math.floor(Number(options.maxShots || 8)));
  const chunks: StoryboardRow[][] = [];
  let chunk: StoryboardRow[] = [];
  let chunkDuration = 0;

  for (const storyboard of storyboards) {
    const duration = Math.min(parseDuration(storyboard.duration), maxDuration);
    if (chunk.length && (chunkDuration + duration > maxDuration || chunk.length >= maxShots)) {
      chunks.push(chunk);
      chunk = [];
      chunkDuration = 0;
    }
    chunk.push(storyboard);
    chunkDuration += duration;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return "[]";
  }
}

function parseJsonArray(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number).filter((item) => Number.isFinite(item));
  try {
    const parsed = JSON.parse(String(value || "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed.map(Number).filter((item) => Number.isFinite(item));
  } catch {
    return [];
  }
}

function isRoleAsset(asset: AssetRow) {
  const type = clean(asset.type).toLowerCase();
  return type === "role" || type === "character" || type === "角色";
}

function isSceneAsset(asset: AssetRow) {
  const type = clean(asset.type).toLowerCase();
  return type === "scene" || type === "场景";
}

function nameKey(value: unknown) {
  return clean(value).toLowerCase();
}

export function buildChapterDirectorBoardPrompt(input: {
  project: ProjectRow;
  script: ScriptRow;
  boardIndex: number;
  totalBoards: number;
  storyboards: StoryboardRow[];
  assets: AssetRow[];
  language?: DirectorBoardPromptLanguage;
}) {
  const { project, script, boardIndex, totalBoards, storyboards, assets } = input;
  const language = input.language || detectDirectorBoardPromptLanguage({ project, script, storyboards });
  const isChinese = language === "chinese";
  const startSecond = storyboards.reduce((sum, shot, index) => (index === 0 ? 0 : sum + parseDuration(storyboards[index - 1]?.duration)), 0);
  let cursor = startSecond;
  const shotLines = storyboards.map((shot) => {
    const duration = parseDuration(shot.duration);
    const start = cursor;
    cursor += duration;
    return [
      `${isChinese ? "镜头" : "Shot"} ${String((shot.index ?? 0) + 1).padStart(2, "0")}`,
      `${isChinese ? "时间" : "time"}=${start}-${cursor}s`,
      `${isChinese ? "动作" : "action"}=${compact(shot.videoDesc, 320)}`,
      `${isChinese ? "画面线索" : "visual cue"}=${compact(shot.prompt, 220)}`,
    ].join(" | ");
  });

  const otherAssetLines = assets.filter((asset) => !isRoleAsset(asset) && !isSceneAsset(asset)).map((asset, index) => {
    return [
      `${isChinese ? "参考" : "Ref"} ${index + 1}`,
      `id=${asset.id}`,
      `${isChinese ? "类型" : "type"}=${asset.type || (isChinese ? "素材" : "asset")}`,
      `${isChinese ? "名称" : "name"}=${asset.name || (isChinese ? "未命名" : "unnamed")}`,
      `${isChinese ? "描述" : "description"}=${compact(asset.prompt || asset.describe, 220)}`,
    ].join(" | ");
  });
  const roleLines = assets.filter(isRoleAsset).map((asset, index) => {
    return [
      `C${index + 1}`,
      `${isChinese ? "名称" : "name"}=${asset.name || (isChinese ? "未命名角色" : "unnamed role")}`,
      `${isChinese ? "身份符号" : "identity symbols"}=${compact(
        asset.roleFacts ||
          asset.prompt ||
          asset.describe ||
          (asset.filePath ? (isChinese ? "已附加角色参考图；只提取可见的符号身份标记" : "attached role reference image; extract only visible symbolic identity markers") : ""),
        280,
      )}`,
      asset.negativeRoleFacts ? `${isChinese ? "禁止误读" : "negative facts"}=${compact(asset.negativeRoleFacts, 180)}` : "",
    ]
      .filter(Boolean)
      .join(" | ");
  });
  const sceneLines = assets.filter(isSceneAsset).map((asset, index) => {
    return [
      `${isChinese ? "场景" : "Scene"} ${index + 1}`,
      `${isChinese ? "名称" : "name"}=${asset.name || (isChinese ? "未命名场景" : "unnamed scene")}`,
      `${isChinese ? "参考" : "reference"}=${asset.filePath ? (isChinese ? "已附加场景参考图" : "attached scene reference image is available") : isChinese ? "无图片参考" : "no image reference"}`,
      `${isChinese ? "描述" : "description"}=${compact(asset.prompt || asset.describe, 260)}`,
    ].join(" | ");
  });

  if (isChinese) {
    return [
      "生成一张横向 16:9 章节导演板，用于给视频模型参考。",
      "它不是最终画面，只表达本组镜头的空间、机位、角色位置、动作连续、灯光和节奏。",
      "",
      "简单版式：",
      "左侧：角色图例和主要场景参考。",
      "中上：彩色俯视调度图，标出场景布局、角色位置、摄像机、运动箭头和光源。",
      "中下：4-6 个连续分镜小格，每格写镜头号、时间、景别、镜头运动和核心动作。",
      "右侧：很简洁的动作流/位置变化草图。",
      "底部：少量灯光、道具、颜色和连续性备注。",
      "",
      "画面风格：",
      "彩色场景、浅色纸张背景、细黑分隔线、干净的导演标注。",
      "角色只画成简单铅笔/马克笔符号或剪影，不画精细脸部和最终角色立绘。",
      "每次角色出现都在旁边标 C编号+名称，例如 C1 Chloe；同一角色全图使用同一个高对比色标记。",
      "用最明显的身份符号区分角色：水果/物种颜色、体型、固定服装、关键道具、武器或工具。",
      "角色事实卡和角色参考图只用于识别身份符号；不要把柠檬画成青柠，不要把水蜜桃画成草莓，不要发明新角色设计。",
      "场景参考图用于确定环境布局、色彩、入口、桌面、墙面、灯光和道具。",
      "画面文字保持简短可读，并统一使用中文；角色名、C编号和必要专有名词可保留原文。",
      "不要画成漫画页、海报或 UI 截图。",
      "",
      "项目信息：",
      `标题：${project.name || "未命名"}`,
      `工作区：${script.name || `script ${script.id}`}`,
      `导演板：${boardIndex + 1}/${totalBoards}`,
      `视频画幅比例：${project.videoRatio || "9:16"}`,
      `项目类型：${project.type || "短剧"}`,
      `视觉风格：${compact([project.artStyle, project.directorManual].filter(Boolean).join("; "), 360) || "电影化动画"}`,
      "",
      "角色图例：",
      roleLines.length ? roleLines.join("\n") : "没有关联角色资产。请从分镜描述中推导临时 C编号，并在本张导演板内保持稳定。",
      "",
      "场景参考：",
      sceneLines.length ? sceneLines.join("\n") : "没有关联场景资产。只根据分镜描述构建场景。",
      "",
      "其他素材：",
      otherAssetLines.length ? otherAssetLines.join("\n") : "无其他素材。",
      "",
      "覆盖镜头：",
      shotLines.join("\n"),
    ].join("\n");
  }

  return [
    "Create one wide 16:9 chapter director board for video-generation reference.",
    "It is not a final video frame. It only shows space, camera blocking, character positions, action continuity, lighting, and pacing for these shots.",
    "",
    "Simple layout:",
    "Left: character legend and main scene reference.",
    "Center top: colored overhead blocking map with scene layout, character positions, cameras, movement arrows, and light direction.",
    "Center bottom: 4-6 sequential shot panels. Each panel has shot number, time, framing, camera move, and core action.",
    "Right: very simple action-flow / position-change sketches.",
    "Bottom: a few lighting, prop, color, and continuity notes.",
    "",
    "Image style:",
    "colored scenes, light paper background, thin black dividers, clean director notes.",
    "Draw characters as simple pencil/marker symbols or silhouettes, not detailed portraits or final character art.",
    "Every character figure must have a nearby C-number + name label, for example C1 Chloe. Use one stable high-contrast color marker per character.",
    "Differentiate characters with only the strongest identity symbols: fruit/species color, body scale, fixed outfit, key prop, weapon, or tool.",
    "Use role facts and role reference images only for symbolic identity. Do not turn lemon into lime, peach into strawberry, or invent a new final design.",
    "Use scene reference images for environment layout, colors, entrances, tables, walls, lighting, and props.",
    "Keep all visible board text short and readable. English only. Do not make a comic page, poster, or UI screenshot.",
    "",
    "Project:",
    `title: ${project.name || "Untitled"}`,
    `workspace: ${script.name || `script ${script.id}`}`,
    `board: ${boardIndex + 1}/${totalBoards}`,
    `video aspect ratio: ${project.videoRatio || "9:16"}`,
    `project type: ${project.type || "short drama"}`,
    `visual style: ${compact([project.artStyle, project.directorManual].filter(Boolean).join("; "), 360) || "cinematic animation"}`,
    "",
    "Character legend:",
    roleLines.length ? roleLines.join("\n") : "No role assets are linked. Derive temporary C-number labels from the storyboard descriptions and keep them stable across this board.",
    "",
    "Scene references:",
    sceneLines.length ? sceneLines.join("\n") : "No scene asset is linked. Build a scene only from the storyboard descriptions.",
    "",
    "Other assets:",
    otherAssetLines.length ? otherAssetLines.join("\n") : "No other assets.",
    "",
    "Covered shots:",
    shotLines.join("\n"),
  ].join("\n");
}

async function getAssetReferenceImages(assets: AssetRow[], maxCount = 12) {
  const usableAssets = assets.filter((asset) => asset.filePath).slice(0, maxCount);
  const references = [];
  for (const asset of usableAssets) {
    try {
      references.push({ type: "image" as const, base64: await u.oss.getImageBase64(asset.filePath!) });
    } catch {
      // Ignore missing references; the prompt still carries textual constraints.
    }
  }
  return references;
}

async function attachRoleFactCards(projectId: number, assets: AssetRow[]) {
  const roleAssets = assets.filter(isRoleAsset);
  if (!roleAssets.length) return assets;
  const assetIds = roleAssets.map((asset) => Number(asset.id)).filter((id) => Number.isFinite(id));
  const roleNames = roleAssets.map((asset) => clean(asset.name)).filter(Boolean);
  if (!assetIds.length && !roleNames.length) return assets;

  const query = u.db("o_roleFactCards").where("projectId", projectId);
  query.andWhere((builder: any) => {
    if (assetIds.length) builder.whereIn("assetId", assetIds);
    if (roleNames.length) {
      if (assetIds.length) builder.orWhereIn("roleName", roleNames);
      else builder.whereIn("roleName", roleNames);
    }
  });
  const cards = (await query.select("assetId", "roleName", "facts", "negativeFacts")) as RoleFactCardRow[];
  if (!cards.length) return assets;

  const byAssetId = new Map<number, RoleFactCardRow>();
  const byRoleName = new Map<string, RoleFactCardRow>();
  for (const card of cards) {
    if (card.assetId) byAssetId.set(Number(card.assetId), card);
    if (card.roleName) byRoleName.set(nameKey(card.roleName), card);
  }
  return assets.map((asset) => {
    if (!isRoleAsset(asset)) return asset;
    const card = byAssetId.get(Number(asset.id)) || byRoleName.get(nameKey(asset.name));
    if (!card) return asset;
    return {
      ...asset,
      roleFacts: card.facts || asset.roleFacts,
      negativeRoleFacts: card.negativeFacts || asset.negativeRoleFacts,
    };
  });
}

async function getStoryboardAssets(projectId: number, storyboardIds: number[]) {
  if (!storyboardIds.length) return [];
  const rows = await u
    .db("o_assets2Storyboard")
    .leftJoin("o_assets", "o_assets2Storyboard.assetId", "o_assets.id")
    .leftJoin("o_image", "o_assets.imageId", "o_image.id")
    .whereIn("o_assets2Storyboard.storyboardId", storyboardIds)
    .orderBy("o_assets2Storyboard.rowid", "asc")
    .select("o_assets.id", "o_assets.name", "o_assets.type", "o_assets.describe", "o_assets.prompt", "o_image.filePath");
  const seen = new Set<number>();
  const result: AssetRow[] = [];
  for (const row of rows as AssetRow[]) {
    if (!row.id || seen.has(row.id)) continue;
    seen.add(row.id);
    result.push(row);
  }
  return attachRoleFactCards(projectId, result);
}

async function runDirectorBoardImageTask(
  rowId: number,
  data: {
    project: ProjectRow;
    script: ScriptRow;
    storyboards: StoryboardRow[];
    assets: AssetRow[];
    prompt: string;
    promptLanguage: DirectorBoardPromptLanguage;
    model: string;
  },
) {
  const { project, script, storyboards, assets, prompt, promptLanguage, model } = data;
  const savePath = `/${project.id}/directorBoard/${script.id}/${uuidv4()}.jpg`;
  try {
    const finalPrompt = await normalizeDirectorBoardPromptLanguage(prompt, promptLanguage);
    if (finalPrompt !== prompt) {
      await u.db("o_directorBoard").where("id", rowId).update({
        prompt: finalPrompt,
        updateTime: Date.now(),
      });
    }
    const image = await u.Ai.Image(model as `${string}:${string}`).run(
      {
        prompt: finalPrompt,
        referenceList: await getAssetReferenceImages(assets),
        size: (project.imageQuality || "1K") as "1K" | "2K" | "4K",
        aspectRatio: "16:9",
      },
      {
        taskClass: "章节导演板生成",
        describe: "章节导演板生成",
        relatedObjects: JSON.stringify({
          projectId: project.id,
          scriptId: script.id,
          storyboardIds: storyboards.map((item) => item.id),
        }),
        projectId: project.id,
      },
    );
    await image.save(savePath);
    await u.db("o_directorBoard").where("id", rowId).update({
      filePath: savePath,
      state: "已完成",
      reason: "",
      updateTime: Date.now(),
    });
  } catch (error) {
    await u.db("o_directorBoard").where("id", rowId).update({
      state: "生成失败",
      reason: u.error(error).message,
      updateTime: Date.now(),
    });
  }
}

export async function queueDirectorBoardGeneration(projectId: number, scriptId: number, options: QueueDirectorBoardOptions = {}) {
  const project = (await u.db("o_project").where("id", projectId).first()) as ProjectRow | undefined;
  if (!project?.id) throw new Error("项目不存在，无法生成章节导演板。");
  const script = (await u.db("o_script").where({ id: scriptId, projectId }).first()) as ScriptRow | undefined;
  if (!script?.id) throw new Error("章节工作区不存在，无法生成章节导演板。");
  const shouldGenerateImages = options.generateImages === true;
  const model = clean(options.model || project.imageModel);
  if (shouldGenerateImages && !model) throw new Error("项目未配置出图模型，无法生成章节导演板图片。");

  const baseQuery = u.db("o_storyboard").where({ projectId, scriptId });
  if (options.storyboardIds?.length) baseQuery.whereIn("id", options.storyboardIds);
  const storyboards = (await baseQuery.orderBy("index", "asc").select("id", "index", "prompt", "videoDesc", "duration", "filePath", "trackId")) as StoryboardRow[];
  if (!storyboards.length) throw new Error("当前章节没有可用于导演板的分镜。");

  const shotsPerBoard = Math.min(Math.max(Number(options.shotsPerBoard || 6), 1), 8);
  const chunks = chunkStoryboardsForDirectorBoards(storyboards, {
    maxDuration: MAX_DIRECTOR_BOARD_DURATION_SECONDS,
    maxShots: shotsPerBoard,
  });
  if (options.replace !== false) {
    await u.db("o_directorBoard").where({ projectId, scriptId }).delete();
  }

  const created: DirectorBoardRow[] = [];
  for (const [boardIndex, chunk] of chunks.entries()) {
    const assets = await getStoryboardAssets(projectId, chunk.map((item) => item.id));
    const promptLanguage = detectDirectorBoardPromptLanguage({ project, script, storyboards: chunk });
    const prompt = buildChapterDirectorBoardPrompt({
      project,
      script,
      boardIndex,
      totalBoards: chunks.length,
      storyboards: chunk,
      assets,
      language: promptLanguage,
    });
    const [rowId] = await u.db("o_directorBoard").insert({
      projectId,
      scriptId,
      name: `章节导演板 ${boardIndex + 1}/${chunks.length}`,
      prompt,
      state: shouldGenerateImages ? "生成中" : "未生成",
      reason: "",
      model,
      storyboardIds: safeJson(chunk.map((item) => item.id)),
      assetIds: safeJson(assets.map((item) => item.id)),
      index: boardIndex,
      createTime: Date.now() + boardIndex,
      updateTime: Date.now(),
    });
    const row = (await u.db("o_directorBoard").where("id", rowId).first()) as DirectorBoardRow;
    created.push(row);
    if (shouldGenerateImages) {
      void runDirectorBoardImageTask(Number(rowId), { project, script, storyboards: chunk, assets, prompt, promptLanguage, model });
    }
  }

  return created;
}

export async function regenerateDirectorBoard(projectId: number, scriptId: number, boardId: number, options: RegenerateDirectorBoardOptions = {}) {
  const row = (await u.db("o_directorBoard").where({ id: boardId, projectId, scriptId }).first()) as DirectorBoardRow | undefined;
  if (!row?.id) throw new Error("章节导演板不存在，无法重绘。");

  const project = (await u.db("o_project").where("id", projectId).first()) as ProjectRow | undefined;
  if (!project?.id) throw new Error("项目不存在，无法重绘章节导演板。");
  const script = (await u.db("o_script").where({ id: scriptId, projectId }).first()) as ScriptRow | undefined;
  if (!script?.id) throw new Error("章节工作区不存在，无法重绘章节导演板。");

  const storyboardIds = parseJsonArray(row.storyboardIds);
  if (!storyboardIds.length) throw new Error("该章节导演板缺少覆盖分镜信息，无法只重绘这一张。");

  const storyboards = (await u
    .db("o_storyboard")
    .where({ projectId, scriptId })
    .whereIn("id", storyboardIds)
    .orderBy("index", "asc")
    .select("id", "index", "prompt", "videoDesc", "duration", "filePath", "trackId")) as StoryboardRow[];
  if (!storyboards.length) throw new Error("该章节导演板对应的分镜不存在，无法重绘。");

  const totalBoardsRow = (await u.db("o_directorBoard").where({ projectId, scriptId }).count({ count: "id" }).first()) as { count?: number | string } | undefined;
  const totalBoards = Math.max(1, Number(totalBoardsRow?.count || 1));
  const boardIndex = Number.isFinite(Number(row.index)) ? Number(row.index) : 0;
  const assets = await getStoryboardAssets(projectId, storyboards.map((item) => item.id));
  const promptLanguage = detectDirectorBoardPromptLanguage({ project, script, storyboards });
  const prompt = buildChapterDirectorBoardPrompt({
    project,
    script,
    boardIndex,
    totalBoards,
    storyboards,
    assets,
    language: promptLanguage,
  });
  const model = clean(options.model || project.imageModel || row.model);
  if (!model) throw new Error("项目未配置出图模型，无法重绘章节导演板。");

  await u.db("o_directorBoard").where("id", boardId).update({
    prompt,
    filePath: null,
    state: "生成中",
    reason: "",
    model,
    assetIds: safeJson(assets.map((item) => item.id)),
    updateTime: Date.now(),
  });

  void runDirectorBoardImageTask(boardId, { project, script, storyboards, assets, prompt, promptLanguage, model });
  return (await u.db("o_directorBoard").where("id", boardId).first()) as DirectorBoardRow;
}

export async function listDirectorBoards(projectId: number, scriptId: number) {
  const rows = (await u.db("o_directorBoard").where({ projectId, scriptId }).orderBy("index", "asc").orderBy("id", "asc")) as DirectorBoardRow[];
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      src: row.filePath ? await u.oss.getSmallImageUrl(row.filePath) : "",
      previewSrc: row.filePath ? await u.oss.getFileUrl(row.filePath) : "",
    })),
  );
}
