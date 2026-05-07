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
}

export type DirectorBoardPromptLanguage = "english" | "chinese";

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

function chunkItems<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
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
      `${isChinese ? "视频描述" : "videoDesc"}=${compact(shot.videoDesc, 700)}`,
      `${isChinese ? "首帧提示" : "keyframe prompt"}=${compact(shot.prompt, 500)}`,
    ].join(" | ");
  });

  const assetLines = assets.map((asset, index) => {
    return [
      `${isChinese ? "参考" : "Ref"} ${index + 1}`,
      `id=${asset.id}`,
      `${isChinese ? "类型" : "type"}=${asset.type || (isChinese ? "素材" : "asset")}`,
      `${isChinese ? "名称" : "name"}=${asset.name || (isChinese ? "未命名" : "unnamed")}`,
      `${isChinese ? "描述" : "description"}=${compact(asset.prompt || asset.describe, 360)}`,
    ].join(" | ");
  });
  const roleLines = assets.filter(isRoleAsset).map((asset, index) => {
    return [
      `C${index + 1}`,
      `${isChinese ? "名称" : "name"}=${asset.name || (isChinese ? "未命名角色" : "unnamed role")}`,
      `${isChinese ? "权威事实" : "authoritative facts"}=${compact(
        asset.roleFacts ||
          asset.prompt ||
          asset.describe ||
          (asset.filePath ? (isChinese ? "已附加角色参考图；只提取可见的符号身份标记" : "attached role reference image; extract only visible symbolic identity markers") : ""),
        760,
      )}`,
      asset.negativeRoleFacts ? `${isChinese ? "禁止误读" : "negative facts"}=${compact(asset.negativeRoleFacts, 520)}` : "",
    ]
      .filter(Boolean)
      .join(" | ");
  });
  const sceneLines = assets.filter(isSceneAsset).map((asset, index) => {
    return [
      `${isChinese ? "场景" : "Scene"} ${index + 1}`,
      `${isChinese ? "名称" : "name"}=${asset.name || (isChinese ? "未命名场景" : "unnamed scene")}`,
      `${isChinese ? "参考" : "reference"}=${asset.filePath ? (isChinese ? "已附加场景参考图" : "attached scene reference image is available") : isChinese ? "无图片参考" : "no image reference"}`,
      `${isChinese ? "描述" : "description"}=${compact(asset.prompt || asset.describe, 620)}`,
    ].join(" | ");
  });

  if (isChinese) {
    return [
      "生成一张专业电影化章节导演板，单张横向 16:9 制作规划图。",
      "这张图不是最终视频画面，而是给视频生成模型参考的导演规划板。",
      "",
      "主要目标：",
      "展示多个视频片段之间的空间连续性、机位调度、角色位置、姿态/状态延续、场景布局、镜头顺序和灯光连续性。",
      "这张导演板只作为布局与调度参考，不作为最终角色身份参考。",
      "",
      "强制版式：",
      "1. 顶部黑色标题栏：项目标题、章节/工作区名称、导演板编号、覆盖镜头、预计总时长、视频画幅比例、视觉风格关键词。",
      "2. 左侧栏：彩色场景参考面板和角色符号图例。图例必须使用简单符号、强颜色点、清晰名称和 C1/C2/C3 标签，不要画成精细角色肖像。",
      "3. 中上区域：彩色俯视调度地图，展示场景布局、角色位置、摄像机位置、运动箭头、视线方向和光源方向。",
      "4. 中下区域：连续分镜条，包含 4-6 个彩色小面板；每个面板必须包含镜头编号、时间范围、景别、镜头运动和核心动作。",
      "5. 右侧栏：从一个镜头到下一个镜头的简化彩色动作流草图，重点表达身体位置、方向、距离和连续性。",
      "6. 底部条：灯光、道具、材质、色彩方案和连续性备注。",
      "",
      "视觉风格：",
      "干净的制作分镜板，细黑网格线，浅色纸张背景，可读的小标签，彩色规划草图，实用导演标注，无 UI，无水印。",
      "不要做成灰阶或大面积黑白。场景参考、调度地图、分镜面板、动作流面板、灯光备注、道具和色板都必须使用符合故事环境的清晰色彩。",
      "调度地图、分镜条和动作流草图中的角色必须是简单彩色线稿、符号化剪影或粗略铅笔人物，并带有强颜色身份标记。",
      "不要在分镜/动作面板中渲染精细脸部、复杂服装、皮肤/材质纹理或最终角色美术。",
      "环境、道具、摄像机箭头、灯光和空间备注可以更详细并明显上色；角色身体保持示意化，但必须能区分。",
      "画面内所有标签和标注统一使用中文；角色名、C编号、id 和必要专有名词可以保留原文。",
      "",
      "角色可读性规则：",
      "调度地图、分镜条和动作流栏中的每一次角色出现，都必须在人物旁边直接标注 C编号和名称，例如 C1 Chloe。",
      "每个角色在整张导演板中使用一个稳定的高对比色标记；图例、地图标记、分镜人物描边和动作流人物都重复这个颜色。",
      "根据角色描述给每个角色设计不同的符号轮廓：水果/物种提示、体型比例、关键道具、护甲/服装速写、武器/工具图标，必要时使用发型/帽子符号。",
      "角色可以画得示意化，但观看者必须不用读长段文字也能识别角色。不要把所有角色都画成同一种圆形身体。",
      "如果提供了角色参考图，只提取水果类型、颜色体系、主要服装、武器、体型等符号识别点；不要复制成品脸部或最终渲染风格。",
      "",
      "一致性规则：",
      "最终角色身份属于后续视频生成时单独传入的角色资产参考图，不属于这张导演板。",
      "角色事实卡是角色物种、水果类型、身体颜色、固定服装、道具、武器、体型和禁止误读的最高约束。",
      "用名称标签、C编号、颜色标记、水果/物种提示、身体朝向、姿势、动作和情绪状态表示每个角色。",
      "不要把已知水果类型或颜色替换成相近猜测：不要把柠檬变成青柠、水蜜桃变成草莓、橙子变成水蜜桃，也不要把任何有名角色变成泛化水果。",
      "如果没有角色事实卡但附加了角色参考图，请从参考图中识别可见水果物种、主身体颜色、主要服装、道具/武器和轮廓，不要根据上下文猜成其他物种。",
      "不要在导演板上发明或锁定新的脸、服装、身体材质或最终角色设计。",
      "道具和场景建筑必须与已提供的非角色参考图和资产描述保持一致。",
      "场景参考图对环境建筑、色彩氛围、光线方向、入口、桌子、墙面、道具和空间气质具有权威性。俯视地图和场景面板必须改编参考场景，而不是泛化地点。",
      "不要把导演板画成漫画页。它必须像实用的 AI 视频制作导演板。",
      "标签必须简洁可读。避免在画面中出现长段文字。",
      "",
      "项目：",
      `标题：${project.name || "未命名"}`,
      `工作区：${script.name || `script ${script.id}`}`,
      `导演板：${boardIndex + 1}/${totalBoards}`,
      `视频画幅比例：${project.videoRatio || "9:16"}`,
      `项目类型：${project.type || "短剧"}`,
      `视觉风格：${compact([project.artStyle, project.directorManual].filter(Boolean).join("; "), 900) || "电影化动画"}`,
      "",
      "角色身份图例遵循：",
      roleLines.length ? roleLines.join("\n") : "没有关联角色资产。请从分镜描述中推导临时 C编号标签，并在本张导演板内保持稳定。",
      "",
      "场景参考遵循：",
      sceneLines.length ? sceneLines.join("\n") : "没有关联场景资产。只根据分镜描述构建场景。",
      "",
      "参考素材：",
      assetLines.length ? assetLines.join("\n") : "没有可用参考素材图。只使用分镜描述。",
      "",
      "本张导演板覆盖的分镜：",
      shotLines.join("\n"),
    ].join("\n");
  }

  return [
    "Create one professional cinematic chapter director board as a single wide 16:9 production planning sheet.",
    "This image is NOT the final video frame. It is a director planning board for video-generation reference.",
    "",
    "Primary goal:",
    "Show spatial continuity, camera blocking, character positions, pose/state continuity, scene layout, shot order, and lighting continuity across multiple video clips.",
    "This board is a layout and blocking reference only. It is NOT a character identity reference for the final video.",
    "",
    "Required layout:",
    "1. Top black header bar: project title, chapter/workspace name, board number, covered shots, total estimated time, video aspect ratio, visual style keywords.",
    "2. Left column: colored scene reference panel and character symbol legend. The legend must use simple symbolic icons, strong color dots, readable names, and C1/C2/C3 labels, not finished character portraits.",
    "3. Center top: colored overhead blocking map, showing scene layout, character positions, camera positions, movement arrows, eye lines, and light direction.",
    "4. Center bottom: sequential storyboard strip with 4-6 colored panels. Each panel must include shot number, time range, shot size, camera movement, and the core action.",
    "5. Right column: simplified colored action-flow sketches from shot to shot, focusing on body position, direction, distance, and continuity.",
    "6. Bottom strip: lighting, props, materials, color palette, and continuity notes.",
    "",
    "Visual style:",
    "clean production storyboard sheet, thin black grid lines, light paper background, readable small labels, colored planning sketches, practical director annotations, no UI, no watermark.",
    "Do not make a grayscale or mostly black-and-white board. The scene reference, blocking map, storyboard panels, action-flow panels, lighting notes, props, and palette must use clear color washes that match the story setting.",
    "Characters in the blocking map, storyboard strip, and action-flow sketches must be simple colored line figures, symbolic silhouettes, or rough pencil figures with strong color identifiers only.",
    "Do not render polished faces, detailed costumes, skin/material textures, or final character art inside the storyboard/action panels.",
    "Environment, props, camera arrows, lighting, and spatial notes may be more detailed and visibly colored; character bodies should remain schematic but must not become indistinguishable.",
    "All visible board labels and annotations must be in English only. Character names, C-number labels, ids, and necessary proper nouns may stay as written.",
    "",
    "Character readability rules:",
    "Every character appearance in the blocking map, storyboard strip, and action-flow column must be labeled directly beside the figure with its C-number and name, for example C1 Chloe.",
    "Use one stable high-contrast color marker per character across the whole board. Repeat that color on the legend, map marker, storyboard figure outline, and action-flow figure.",
    "Give each character a distinct symbolic silhouette based on the role description: fruit/species hint, body scale, key prop, armor/clothing shorthand, weapon/tool icon, or hairstyle/hat symbol when relevant.",
    "A character may be drawn schematically, but the viewer must be able to identify the character without reading long notes. Do not draw all characters as the same round body.",
    "If a role reference image is provided, use it only to extract symbolic identifiers such as fruit type, color family, major outfit, weapon, and body scale. Do not copy the finished face or final rendering style.",
    "",
    "Consistency rules:",
    "Final character identity belongs to the separate role asset reference images used later in video generation, not to this director board.",
    "Role fact cards are the highest authority for character species, fruit type, body color, fixed clothing, props, weapons, body scale, and forbidden misreadings.",
    "Represent each character by name label, C-number, color marker, fruit/species hint if relevant, body direction, pose, action, and emotion state.",
    "Never replace a role's known fruit type or color with a nearby guess: do not turn lemon into lime, peach into strawberry, orange into peach, or any named character into a generic fruit.",
    "If no role fact card exists but a role reference image is attached, inspect that reference image for the visible fruit species, dominant body color, major outfit, prop/weapon, and silhouette. Use those visible identifiers; do not guess a different fruit species from context.",
    "Do not invent or lock a new face, outfit, body material, or final character design on this board.",
    "Keep props and scene architecture consistent with the provided non-role reference images and asset descriptions.",
    "Scene reference images are authoritative for environment architecture, color mood, lighting direction, entrances, tables, walls, props, and spatial feel. The overhead map and scene panel must adapt the referenced scene, not a generic location.",
    "Do not turn the board into a comic page. It must look like a practical director board for AI video production.",
    "Labels must be concise and readable. Avoid long paragraphs inside the image.",
    "",
    "Project:",
    `title: ${project.name || "Untitled"}`,
    `workspace: ${script.name || `script ${script.id}`}`,
    `board: ${boardIndex + 1}/${totalBoards}`,
    `video aspect ratio: ${project.videoRatio || "9:16"}`,
    `project type: ${project.type || "short drama"}`,
    `visual style: ${compact([project.artStyle, project.directorManual].filter(Boolean).join("; "), 900) || "cinematic animation"}`,
    "",
    "Character identity legend to follow:",
    roleLines.length ? roleLines.join("\n") : "No role assets are linked. Derive temporary C-number labels from the storyboard descriptions and keep them stable across this board.",
    "",
    "Scene references to follow:",
    sceneLines.length ? sceneLines.join("\n") : "No scene asset is linked. Build a scene only from the storyboard descriptions.",
    "",
    "Reference assets:",
    assetLines.length ? assetLines.join("\n") : "No reference asset image is available. Use the storyboard descriptions only.",
    "",
    "Storyboard shots covered by this board:",
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
  const model = clean(options.model || project.imageModel);
  if (!model) throw new Error("项目未配置出图模型，无法生成章节导演板。");

  const baseQuery = u.db("o_storyboard").where({ projectId, scriptId });
  if (options.storyboardIds?.length) baseQuery.whereIn("id", options.storyboardIds);
  const storyboards = (await baseQuery.orderBy("index", "asc").select("id", "index", "prompt", "videoDesc", "duration", "filePath", "trackId")) as StoryboardRow[];
  if (!storyboards.length) throw new Error("当前章节没有可用于导演板的分镜。");

  const shotsPerBoard = Math.min(Math.max(Number(options.shotsPerBoard || 6), 3), 8);
  const chunks = chunkItems(storyboards, shotsPerBoard);
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
      state: "生成中",
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
    void runDirectorBoardImageTask(Number(rowId), { project, script, storyboards: chunk, assets, prompt, promptLanguage, model });
  }

  return created;
}

export async function regenerateDirectorBoard(projectId: number, scriptId: number, boardId: number) {
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
  const model = clean(row.model || project.imageModel);
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
