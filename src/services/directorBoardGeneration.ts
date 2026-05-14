import u from "@/utils";
import { stripThink } from "@/utils/stripThink";
import { inferCameraTechnicalSettings } from "@/services/storyboardDraftGeneration";
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
  focalLength?: string | null;
  aperture?: string | null;
  shutterSpeed?: string | null;
  iso?: string | null;
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
  boardType?: DirectorBoardType | string | null;
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
  imageSize?: DirectorBoardImageSize;
  imageQuality?: DirectorBoardImageSize;
  boardType?: DirectorBoardType;
  shotsPerBoard?: number;
  replace?: boolean;
  generateImages?: boolean;
  usePreviousBoardReference?: boolean;
}

export interface RegenerateDirectorBoardOptions {
  model?: string;
  imageSize?: DirectorBoardImageSize;
  imageQuality?: DirectorBoardImageSize;
  boardType?: DirectorBoardType;
  usePreviousBoardReference?: boolean;
}

export type DirectorBoardPromptLanguage = "english" | "chinese";
export type DirectorBoardType = "continuity" | "textStoryboard" | "hybridStoryboard" | "spatialSixPanel";
type DirectorBoardImageSize = "1K" | "2K" | "4K";

const MAX_DIRECTOR_BOARD_DURATION_SECONDS = 15;
const DEFAULT_DIRECTOR_BOARD_TYPE: DirectorBoardType = "continuity";
const DIRECTOR_BOARD_IMAGE_MAX_ATTEMPTS = 6;
const DIRECTOR_BOARD_IMAGE_RETRY_DELAYS_MS = [30000, 60000, 120000, 180000, 300000];

function directorBoardTypeName(boardType: DirectorBoardType) {
  if (boardType === "textStoryboard") return "文字分镜导演板";
  if (boardType === "hybridStoryboard") return "融合导演板";
  if (boardType === "spatialSixPanel") return "空间6宫格导演板";
  return "章节导演板";
}

function normalizeDirectorBoardImageSize(value: unknown, fallback?: string | null): DirectorBoardImageSize {
  if (value === "1K" || value === "2K" || value === "4K") return value;
  if (fallback === "1K" || fallback === "2K" || fallback === "4K") return fallback;
  return "1K";
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableDirectorBoardImageError(error: unknown) {
  const message = u.error(error).message;
  return /状态码:\s*(429|500|502|503|504|524)|\b(429|500|502|503|504|524)\b|gateway\s*time[-\s]?out|time[-\s]?out|do_request_failed|负载|饱和|稍后|timeout|timed out|ECONNRESET|ETIMEDOUT|EAI_AGAIN|temporarily|rate limit/i.test(message);
}

function getDirectorBoardImageRetryDelayMs(attempt: number) {
  return DIRECTOR_BOARD_IMAGE_RETRY_DELAYS_MS[attempt - 1] ?? DIRECTOR_BOARD_IMAGE_RETRY_DELAYS_MS[DIRECTOR_BOARD_IMAGE_RETRY_DELAYS_MS.length - 1]!;
}

async function runDirectorBoardImageTaskWithRetry(rowId: number, task: () => Promise<void>, maxAttempts = DIRECTOR_BOARD_IMAGE_MAX_ATTEMPTS) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await task();
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryableDirectorBoardImageError(error)) break;
      const delayMs = getDirectorBoardImageRetryDelayMs(attempt);
      const reason = `${u.error(error).message}\n检测到网关/模型任务超时，章节导演板仍保持生成中。正在自动重试 ${attempt + 1}/${maxAttempts}，等待 ${Math.round(delayMs / 1000)} 秒。`;
      await u.db("o_directorBoard").where("id", rowId).update({
        state: "生成中",
        reason,
        updateTime: Date.now(),
      });
      console.warn(`[directorBoardGeneration] image request failed, retrying in ${delayMs}ms (${attempt}/${maxAttempts})`, u.error(error).message);
      await wait(delayMs);
    }
  }
  throw lastError;
}

function normalizeDirectorBoardType(value: unknown): DirectorBoardType {
  if (value === "spatialSixPanel") return "spatialSixPanel";
  if (value === "hybridStoryboard") return "hybridStoryboard";
  return value === "textStoryboard" ? "textStoryboard" : DEFAULT_DIRECTOR_BOARD_TYPE;
}

function compact(value: unknown, maxLength = 800) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}...`;
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function firstReadableClause(value: unknown, maxLength = 155) {
  const text = clean(value)
    .replace(/[#*_`>]+/g, "")
    .replace(/\b(?:prompt|description|describe|role facts?|identity symbols?|negative facts?)\s*[:：]/gi, "")
    .replace(/(?:角色事实|角色描述|资产提示词|提示词|描述|身份符号|禁止误读)\s*[:：]/g, "")
    .trim();
  if (!text) return "";
  const sentence = text.split(/(?<=[.!?。！？])\s+/)[0] || text;
  const clauses = sentence.split(/[;；]\s*/).filter(Boolean).slice(0, 2).join("; ");
  return compact(clauses || sentence, maxLength);
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

function assetBrief(asset: AssetRow, isChinese: boolean, maxLength = 155) {
  const source = [asset.roleFacts, asset.prompt, asset.describe].map(clean).filter(Boolean).join(" ");
  if (isRoleAsset(asset)) {
    return compact(buildMinimalRoleBrief(asset, stripIdentityNegativeClauses(source), isChinese), maxLength);
  }
  const brief = firstReadableClause(source, maxLength);
  if (brief) {
    if (!isChinese && countCjk(brief) >= 2) {
      if (isRoleAsset(asset)) return asset.filePath ? "attached role reference image; use only the strongest visible identity symbols." : "simple symbolic character based on the storyboard context.";
      if (isSceneAsset(asset)) return asset.filePath ? "attached scene reference image; use its layout, colors, entrances, lighting, and props." : "scene based on the storyboard context.";
      return asset.filePath ? "attached visual reference image." : "supporting asset from the storyboard context.";
    }
    return brief;
  }
  if (asset.filePath) return isChinese ? "已附加参考图，只提取最显著身份符号。" : "attached reference image, use only the strongest identity symbols.";
  return isChinese ? "按分镜上下文保持简洁一致。" : "keep simple and consistent with the storyboard context.";
}

function languageSafeBrief(value: unknown, isChinese: boolean, englishFallback: string, chineseFallback: string, maxLength = 220) {
  const brief = firstReadableClause(value, maxLength);
  if (!brief) return isChinese ? chineseFallback : englishFallback;
  if (!isChinese && countCjk(brief) >= 2) return englishFallback;
  if (isChinese && countLatinLetters(brief) > Math.max(80, countCjk(brief) * 2)) return chineseFallback;
  return brief;
}

function hasAnyText(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

export function stripIdentityNegativeClauses(value: unknown) {
  return clean(value)
    .replace(/(?:不要|禁止|严禁|避免|不得|不能|不应|勿)[^。；;\n.]+[。；;\n.]?/g, " ")
    .replace(/不是[^，。；;\n.]+[，。；;\n.]?/g, " ")
    .replace(/\b(?:do\s+not|don't|never|avoid|must\s+not|should\s+not)\b[^.;\n]*/gi, " ")
    .replace(/\bnot\s+(?:a|an|the)?\s*[^.;\n]*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildMinimalRoleBrief(asset: AssetRow, source: string, isChinese: boolean) {
  let identity: string;
  if (/桃子|水蜜桃|peach/i.test(source)) identity = isChinese ? "水蜜桃角色形象" : "a peach figure";
  else if (/草莓|strawberry/i.test(source)) identity = isChinese ? "草莓角色形象" : "a strawberry figure";
  else if (/柠檬|lemon/i.test(source)) identity = isChinese ? "明亮的黄色柠檬形象" : "a bright yellow lemon figure";
  else if (/橙子|橙色果皮|orange/i.test(source)) identity = /士兵|军装|军事|soldier|military/i.test(source) ? (isChinese ? "橙子士兵形象" : "an orange soldier figure") : (isChinese ? "橙子角色形象" : "an orange figure");
  else if (/青柠|lime/i.test(source)) identity = isChinese ? "青柠角色形象" : "a lime figure";
  else if (/苹果|apple/i.test(source)) identity = isChinese ? "苹果角色形象" : "an apple figure";
  else if (/香蕉|banana/i.test(source)) identity = isChinese ? "香蕉角色形象" : "a banana figure";
  else if (/葡萄|grape/i.test(source)) identity = isChinese ? "葡萄角色形象" : "a grape figure";
  else if (/芒果|mango/i.test(source)) identity = isChinese ? "芒果角色形象" : "a mango figure";
  else if (/西瓜|watermelon/i.test(source)) identity = isChinese ? "西瓜角色形象" : "a watermelon figure";
  else if (/zombie|丧尸/i.test(source)) identity = isChinese ? "丧尸角色形象" : "a zombie figure";
  else if (/monster|怪物/i.test(source)) identity = isChinese ? "怪物角色形象" : "a monster figure";
  else if (/水果|果|fruit/i.test(source)) identity = isChinese ? "拟人化水果形象" : "an anthropomorphic fruit figure";
  else identity = isChinese ? "参考图中的角色形象" : "the character shown in the reference image";

  if (asset.filePath) {
    return isChinese ? `${identity}；最终造型以附加角色参考图为准。` : `${identity}; final design from attached role reference.`;
  }
  return isChinese ? `${identity}。` : `${identity}.`;
}

function buildReferenceLines(assets: AssetRow[], isChinese: boolean) {
  const referencedAssets = assets.filter((asset) => asset.filePath).slice(0, 12);
  const source = referencedAssets.length ? referencedAssets : assets.slice(0, 12);
  const roleAssets = assets.filter(isRoleAsset);
  return source.map((asset, index) => {
    const name = asset.name || (isChinese ? "未命名素材" : "Unnamed asset");
    const maxLength = isRoleAsset(asset) ? 120 : 155;
    const roleIndex = isRoleAsset(asset) ? roleAssets.findIndex((role) => Number(role.id) === Number(asset.id) || nameKey(role.name) === nameKey(asset.name)) : -1;
    const roleLabel = roleIndex >= 0 ? ` (C${roleIndex + 1})` : "";
    return `${isChinese ? "参考" : "Ref"} ${index + 1}${roleLabel}: ${name}. ${assetBrief(asset, isChinese, maxLength)}`;
  });
}

function buildCharacterLabelLines(assets: AssetRow[], isChinese: boolean) {
  return assets.filter(isRoleAsset).map((asset, index) => {
    const name = asset.name || (isChinese ? "未命名角色" : "Unnamed character");
    return `C${index + 1} ${name} = ${assetBrief(asset, isChinese, 95)}`;
  });
}

const ENGLISH_ACTION_VERBS =
  "holding|holds|hold|wiping|wipes|wipe|raising|raises|raise|standing|stands|stand|sitting|sits|sit|walking|walks|walk|running|runs|run|turning|turns|turn|moving|moves|move|entering|enters|enter|leaning|leans|lean|recoiling|recoils|recoil|pointing|points|point|closing|closes|close|slamming|slams|slam|gesturing|gestures|gesture|looking|looks|look|watching|watches|watch|asking|asks|ask|squeezed|crossed|smirking|smirks";

const CHINESE_ACTION_VERBS =
  "拿着|握着|擦拭|抬眼|抬头|站着|站立|坐着|走向|进入|转身|靠近|后仰|指向|关闭|合上|拍下|猛拍|做手势|看向|询问|挤在|交叉双臂|坏笑";

function sanitizeRoleAppearanceCue(value: unknown, roleAssets: AssetRow[], isChinese: boolean) {
  let text = clean(value);
  if (!text) return "";

  roleAssets.forEach((asset, index) => {
    const name = clean(asset.name);
    if (!name) return;
    const label = `C${index + 1} ${name}`;
    const escapedName = escapeRegExp(name);

    if (isChinese) {
      const actionPattern = new RegExp(`${escapedName}[^,，。；;|]{0,80}?(${CHINESE_ACTION_VERBS})`, "gi");
      text = text.replace(actionPattern, `${label}$1`);
      const appearancePattern = new RegExp(`${escapedName}(?:的)?(?:黄色柠檬|水蜜桃|桃子|橙子|拟人化|角色|人物|士兵|英雄|剪影|穿[^,，。；;|]{1,30})+`, "gi");
      text = text.replace(appearancePattern, label);
    } else {
      const actionPattern = new RegExp(`\\b${escapedName}\\b[^,.;|]{0,90}?\\b(${ENGLISH_ACTION_VERBS})\\b`, "gi");
      text = text.replace(actionPattern, `${label} $1`);
      const appearancePattern = new RegExp(
        `\\b${escapedName}\\b\\s+(?:yellow\\s+lemon|peach|orange|fruit|anthropomorphic|cartoon|character|hero(?:ine)?|soldier|silhouette|in\\s+[^,.;|]{1,35}|wearing\\s+[^,.;|]{1,35})+`,
        "gi",
      );
      text = text.replace(appearancePattern, label);
    }
  });

  text = text
    .replace(/\b(?:yellow lemon character|peach character|peach heroine|orange fruit soldier)\b/gi, "")
    .replace(/\b(?:in a hoodie|in hoodie|wearing a hoodie|wearing hoodie)\b/gi, "")
    .replace(/\b(?:tired half-lidded eyes|half-lidded eyes|bright yellow lemon|yellow lemon|pink-orange peach|peach silhouette|orange peel)\b/gi, "")
    .replace(/\s+([,.;|])/g, "$1")
    .replace(/,\s*(?=,|$)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return text;
}

function buildShotVisualCue(shot: StoryboardRow, roleAssets: AssetRow[], isChinese: boolean) {
  const sanitizedPrompt = sanitizeRoleAppearanceCue(shot.prompt, roleAssets, isChinese);
  if (sanitizedPrompt) return compact(sanitizedPrompt, 220);
  return isChinese
    ? "仅按镜头动作、构图、场景和道具理解；角色最终外观以角色参考图为准。"
    : "Use only shot composition, action, scene, and props; final character appearance comes from the role references.";
}

function isNoDialogueCue(value: unknown) {
  const text = clean(value).replace(/^["“”'‘’]+|["“”'‘’]+$/g, "");
  return !text || /^(?:无台词|无对白|无|none|no dialogue|no lines|n\/a|-)+[.。！!？?]*$/i.test(text);
}

function extractLabeledCue(source: string, labels: string[]) {
  const labelPattern = labels.map(escapeRegExp).join("|");
  const englishStopPattern = "Main assets|Assets|Characters|Scene|Location|Dialogue|Lines|Sound|SFX|Action|Visual|Prompt";
  const chineseStopPattern = "主要资产|关联资产|场景|地点|对白|台词|音效|动作|画面|提示词";
  const stopLookahead = `(?=(?:(?:\\b(?:${englishStopPattern})\\s*[:：])|(?:(?:${chineseStopPattern})\\s*[:：])|$))`;
  const match = source.match(new RegExp(`(?:${labelPattern})\\s*[:：]\\s*([\\s\\S]*?)${stopLookahead}`, "i"));
  return clean(match?.[1]);
}

function extractQuotedDialogue(source: string) {
  const matches = [...source.matchAll(/["“]([^"”]{2,180})["”]/g)].map((match) => clean(match[1])).filter(Boolean);
  return matches.find((item) => !isNoDialogueCue(item)) || "";
}

function buildVisibleDialogueCue(shot: StoryboardRow, isChinese: boolean) {
  const source = clean([shot.videoDesc, shot.prompt].filter(Boolean).join(" "));
  const labeled = extractLabeledCue(source, isChinese ? ["对白", "台词", "Dialogue", "Lines"] : ["Dialogue", "Lines", "对白", "台词"]);
  const dialogue = labeled || extractQuotedDialogue(source);
  if (isNoDialogueCue(dialogue)) return isChinese ? "无台词" : "No dialogue";
  return compact(dialogue.replace(/\s*[.。]+$/g, ""), isChinese ? 42 : 78);
}

function stripStoryboardMetadata(source: string) {
  return clean(source)
    .replace(/\b(?:Main assets|Assets|Characters|Scene|Location|Dialogue|Lines|Sound|SFX)\s*[:：][\s\S]*?(?=(?:\b(?:Main assets|Assets|Characters|Scene|Location|Dialogue|Lines|Sound|SFX)\s*[:：])|$)/gi, " ")
    .replace(/(?:主要资产|关联资产|场景|地点|对白|台词|音效)\s*[:：][\s\S]*?(?=(?:(?:主要资产|关联资产|场景|地点|对白|台词|音效)\s*[:：])|$)/g, " ")
    .replace(/^\s*(?:Shot\s*\d+|镜头\s*\d+)\s*[:：]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildVisibleActionCue(shot: StoryboardRow, roleAssets: AssetRow[], isChinese: boolean) {
  const source = clean([shot.videoDesc, shot.prompt].filter(Boolean).join(" "));
  const labeled = extractLabeledCue(source, isChinese ? ["动作", "角色动作", "Action"] : ["Action", "动作", "角色动作"]);
  const rawAction = labeled || stripStoryboardMetadata(clean(shot.videoDesc || shot.prompt));
  const sanitized = sanitizeRoleAppearanceCue(rawAction, roleAssets, isChinese) || buildShotVisualCue(shot, roleAssets, isChinese);
  return compact(sanitized.replace(/\s*[.。]+$/g, ""), isChinese ? 70 : 115);
}

export function buildChapterDirectorBoardPrompt(input: {
  project: ProjectRow;
  script: ScriptRow;
  boardIndex: number;
  totalBoards: number;
  storyboards: StoryboardRow[];
  assets: AssetRow[];
  language?: DirectorBoardPromptLanguage;
  boardType?: DirectorBoardType;
  usePreviousBoardReference?: boolean;
}) {
  const { project, script, boardIndex, totalBoards, storyboards, assets } = input;
  const language = input.language || detectDirectorBoardPromptLanguage({ project, script, storyboards });
  const boardType = normalizeDirectorBoardType(input.boardType);
  const isChinese = language === "chinese";
  const roleAssets = assets.filter(isRoleAsset);
  const startSecond = 0;
  let cursor = startSecond;
  const shotLines = storyboards.map((shot) => {
    const duration = parseDuration(shot.duration);
    const cameraTech = inferCameraTechnicalSettings({
      shotSize: shot.videoDesc,
      cameraMove: shot.videoDesc,
      lighting: shot.videoDesc,
      action: `${shot.videoDesc || ""} ${shot.prompt || ""}`,
      focalLength: shot.focalLength,
      aperture: shot.aperture,
      shutterSpeed: shot.shutterSpeed,
      iso: shot.iso,
    });
    const start = cursor;
    cursor += duration;
    return [
      `${isChinese ? "镜头" : "Shot"} ${String((shot.index ?? 0) + 1).padStart(2, "0")}`,
      `${isChinese ? "时间" : "time"}=${start}-${cursor}s`,
      `${isChinese ? "动作" : "action"}=${compact(shot.videoDesc, 320)}`,
      `${isChinese ? "摄影参数" : "camera settings"}=${cameraTech.focalLength}, ${cameraTech.aperture}, ${cameraTech.shutterSpeed}, ${cameraTech.iso}`,
      `${isChinese ? "构图动作线索" : "composition/action cue"}=${buildShotVisualCue(shot, roleAssets, isChinese)}`,
      boardType === "textStoryboard" ? `${isChinese ? "时长" : "duration"}=${duration}s` : "",
    ].filter(Boolean).join(" | ");
  });
  let spatialCursor = startSecond;
  const spatialSixPanelShotLines = storyboards.map((shot, panelIndex) => {
    const duration = parseDuration(shot.duration);
    const cameraTech = inferCameraTechnicalSettings({
      shotSize: shot.videoDesc,
      cameraMove: shot.videoDesc,
      lighting: shot.videoDesc,
      action: `${shot.videoDesc || ""} ${shot.prompt || ""}`,
      focalLength: shot.focalLength,
      aperture: shot.aperture,
      shutterSpeed: shot.shutterSpeed,
      iso: shot.iso,
    });
    const start = spatialCursor;
    spatialCursor += duration;
    return [
      `${isChinese ? "格子" : "Panel"} ${panelIndex + 1}`,
      `${isChinese ? "来源镜头" : "source shot"}=${String((shot.index ?? panelIndex) + 1).padStart(2, "0")}`,
      `${isChinese ? "时间" : "time"}=${start}-${spatialCursor}s`,
      `${isChinese ? "画面动作" : "visible action"}=${buildVisibleActionCue(shot, roleAssets, isChinese)}`,
      `${isChinese ? "可见台词" : "visible dialogue"}=${buildVisibleDialogueCue(shot, isChinese)}`,
      `${isChinese ? "摄影参数" : "camera settings"}=${cameraTech.focalLength}, ${cameraTech.aperture}, ${cameraTech.shutterSpeed}, ${cameraTech.iso}`,
      `${isChinese ? "构图线索" : "composition cue"}=${buildShotVisualCue(shot, roleAssets, isChinese)}`,
    ].join(" | ");
  });

  const referenceLines = buildReferenceLines(assets, isChinese);
  const characterLabelLines = buildCharacterLabelLines(assets, isChinese);
  const otherAssetLines = assets.filter((asset) => !isRoleAsset(asset) && !isSceneAsset(asset)).map((asset, index) => {
    return [
      `${isChinese ? "参考" : "Ref"} ${index + 1}`,
      `id=${asset.id}`,
      `${isChinese ? "类型" : "type"}=${asset.type || (isChinese ? "素材" : "asset")}`,
      `${isChinese ? "名称" : "name"}=${asset.name || (isChinese ? "未命名" : "unnamed")}`,
      `${isChinese ? "描述" : "description"}=${assetBrief(asset, isChinese, 130)}`,
    ].join(" | ");
  });
  const sceneLines = assets.filter(isSceneAsset).map((asset, index) => {
    return [
      `${isChinese ? "场景" : "Scene"} ${index + 1}`,
      `${isChinese ? "名称" : "name"}=${asset.name || (isChinese ? "未命名场景" : "unnamed scene")}`,
      `${isChinese ? "参考" : "reference"}=${asset.filePath ? (isChinese ? "已附加场景参考图" : "attached scene reference image is available") : isChinese ? "无图片参考" : "no image reference"}`,
      `${isChinese ? "描述" : "description"}=${assetBrief(asset, isChinese, 150)}`,
    ].join(" | ");
  });
  const projectTypeText = languageSafeBrief(project.type, isChinese, "English-language short drama", "短剧", 120);
  const visualStyleText = languageSafeBrief(
    [project.artStyle, project.directorManual].filter(Boolean).join("; "),
    isChinese,
    "cinematic animation",
    "电影化动画",
    260,
  );
  const previousBoardReferenceNote = input.usePreviousBoardReference
    ? isChinese
      ? [
          "前文导演板参考：",
          "如果附加参考图中存在上一张导演板图，它通常排在资产参考图之后。只把它当作前文故事连续性、空间关系、角色站位、光线方向、板式风格参考；不要复制上一张的旧镜头内容，不要把旧镜头画成当前镜头。",
        ].join("\n")
      : [
          "Previous-board reference:",
          "If an additional previous director-board image is attached after the asset references, use it only for prior story continuity, spatial relation, character placement, lighting direction, and board style. Do not copy old shots from it into the current shots.",
        ].join("\n")
    : "";

  if (isChinese) {
    if (boardType === "spatialSixPanel") {
      return [
        "生成一张横向 16:9 视觉型章节导演板。",
        "核心要求：上面一个空间图，下面一个 6 宫格图；空间图少字，下方每个格子必须把动作和台词加入进去。",
        "",
        "固定版式：",
        "上半部分占整张图约 40%：彩色俯视空间调度图。必须显示场景平面布局、入口/出口、关键道具、主光方向、角色当前位置、角色移动箭头、摄像机位置和拍摄方向。",
        "下半部分占整张图约 60%：严格 2 行 x 3 列的 6 宫格连续画面，按镜头顺序从左到右、从上到下排列。每格是一个彩色电影感关键画面，用来表达镜头画面、角色动作和动作变化。",
        "每个 6 宫格面板底部必须有两条很短的正常印刷字信息条：Action: 本格核心动作；Dialogue: 本格台词或“无台词”。这两条必须可读，不能省略。",
        "空间图和 6 宫格必须在同一张图内，空间图在上，6 宫格在下，不要改成左右布局。",
        "",
        "图中文字限制：",
        "不要标题栏，不要说明段落，不要完整分镜表格，不要大段对白字幕，不要镜头参数文字，不要 UI 截图，不要水印。",
        "空间图只允许极短定位标签：C1/C2/C3、角色名、1-6 镜头编号、箭头符号、摄像机小图标。",
        "6 宫格每格只允许：镜头编号、C编号/角色名、Action 短动作条、Dialogue 短台词条。除此之外不要写任何文字。",
        "如果台词太长，只截取最关键的短句；如果无台词，明确写“无台词”。所有文字必须清晰正常打印字，不要手写、草写或涂鸦字。",
        "",
        "角色与场景：",
        "角色必须用清晰高对比色和 C编号保持可区分。角色可以简化，但必须保留最显著身份符号：水果/物种颜色、体型、固定服装、关键道具、武器或工具。",
        "角色事实卡和参考图是身份最高依据；不要根据镜头描述发明新外观。C编号在空间图和 6 宫格中必须始终对应同一角色。",
        "场景必须彩色、清晰、有空间层次，尽量参考场景资产的布局、颜色、入口、墙面、灯光和关键道具。",
        "",
        previousBoardReferenceNote,
        "",
        "按顺序使用附加参考图：",
        referenceLines.length ? referenceLines.join("\n") : "无可用参考图。",
        "",
        "角色短标签：",
        characterLabelLines.length ? characterLabelLines.join("\n") : "无角色参考；从分镜中提取临时 C编号。",
        "",
        "项目信息（只作为生成参考，不要画成文字）：",
        `标题：${project.name || "未命名"}`,
        `工作区：${script.name || `script ${script.id}`}`,
        `导演板：${boardIndex + 1}/${totalBoards}`,
        `视频画幅比例：${project.videoRatio || "9:16"}`,
        `项目类型：${projectTypeText}`,
        `视觉风格：${visualStyleText}`,
        "",
        "场景参考（只作为生成参考，不要画成文字）：",
        sceneLines.length ? sceneLines.join("\n") : "没有关联场景资产。只根据分镜描述构建场景。",
        "",
        "其他素材（只作为生成参考，不要画成文字）：",
        otherAssetLines.length ? otherAssetLines.join("\n") : "无其他素材。",
        "",
        "6宫格面板内容：",
        "每行的“画面动作”必须画成对应面板的角色动作；“可见台词”必须写进该面板底部 Dialogue 条。",
        spatialSixPanelShotLines.join("\n"),
      ].join("\n");
    }

    if (boardType === "hybridStoryboard") {
      return [
        "生成一张横向 16:9 融合型章节导演板，把“空间连续性导演板”和“文字分镜导演板”合并在同一张图里。",
        "目标：既让视频模型看懂场景空间、角色站位、机位和运动，也能读到每个镜头的关键文字分镜信息。",
        "不要使用 action flow 面板；不需要单独的动作流区域。",
        "",
        "固定版式：",
        `顶部：印刷体标题栏 “Hybrid Chapter Director Board B${String(boardIndex + 1).padStart(2, "0")}”，并写项目名、镜头范围和总时长。`,
        "左侧 35%：彩色俯视空间调度图。显示场景布局、入口/出口、角色 C编号位置、摄像机机位、运动箭头、视线、主光方向和关键道具。",
        "右侧 65%：6 个竖向分镜卡，按时间顺序排成 2行 x 3列。每张卡上半部分是彩色关键画面缩略图，下半部分是正常印刷字表格。",
        "底部：短连续性备注，只写角色位置变化、光线方向、道具状态、与上一张导演板的衔接。",
        "",
        "每张分镜卡必须包含这些印刷体字段：",
        "Shot / Time / Framing / Camera Move / Lens / Aperture / Shutter / ISO / Action / Dialogue or Sound。",
        "文字必须是清晰正常打印字、无衬线字体、黑色或深灰色，不要手写字、草绘字、潦草字、涂鸦字。视频模型必须能读清楚。",
        "",
        "画面风格：",
        "场景必须彩色、清晰、有空间层次，尽量参考场景资产。",
        "角色可以简化为清晰彩色符号或简笔人物，但必须通过 C编号+名称+高对比色标记明确区分。",
        "角色只取最显著身份符号：水果/物种颜色、体型、固定服装、关键道具、武器或工具。",
        "角色事实卡和角色参考图是身份最高依据；保持物种/物体身份、固定造型、服装、轮廓和关键道具，不要发明新角色设计。",
        "C编号是强绑定身份：同一个 C编号在全图必须始终对应同一个角色，不能把 C1/C2/C3 的外形互换。",
        "覆盖镜头里的构图动作线索只用于理解镜头、动作、场景和道具；若其中出现角色服装/外貌描述，与角色参考图或事实卡冲突时必须忽略。",
        "不要画成漫画页、海报或软件 UI 截图。",
        "",
        previousBoardReferenceNote,
        "",
        "按顺序使用附加参考图：",
        referenceLines.length ? referenceLines.join("\n") : "无可用参考图。",
        "",
        "角色标签：",
        characterLabelLines.length ? characterLabelLines.join("\n") : "没有关联角色资产。请从分镜描述中推导临时 C编号，并在本张导演板内保持稳定。",
        "",
        "项目信息：",
        `标题：${project.name || "未命名"}`,
        `工作区：${script.name || `script ${script.id}`}`,
        `导演板：${boardIndex + 1}/${totalBoards}`,
        `视频画幅比例：${project.videoRatio || "9:16"}`,
        `项目类型：${projectTypeText}`,
        `视觉风格：${visualStyleText}`,
        "",
        "场景参考：",
        sceneLines.length ? sceneLines.join("\n") : "没有关联场景资产。只根据分镜描述构建场景。",
        "",
        "其他素材：",
        otherAssetLines.length ? otherAssetLines.join("\n") : "无其他素材。",
        "",
        "分镜卡内容：",
        shotLines.join("\n"),
      ].join("\n");
    }

    if (boardType === "textStoryboard") {
      return [
        "生成一张横向 16:9 文字分镜导演板，用于给视频模型和剪辑人员理解本组镜头。",
        "这张图更接近专业分镜表/导演分镜卡，而不是纯空间调度图；允许更多文字，但必须清晰可读。",
        "",
        "版式要求：",
        "顶部标题栏：写明导演板编号、总时长、覆盖镜头范围和项目名。",
        "主体：优先固定排列 6 个竖向分镜卡；不足 6 个镜头时保留空位，不要改变 16:9 横向整板比例。每张卡上半部分是彩色关键画面，下半部分是结构化文字表格。",
        "每张卡的文字字段：镜号、时间/时长、景别、镜头运动、画面、角色/位置、动作、情绪、环境/灯光、音效、对白。",
        "每张卡还必须显示摄影技术参数：焦距、光圈、快门、ISO。",
        "底部：连续性备注，列出角色位置变化、重要道具、光线方向、身份保持原则。",
        "",
        "画面风格：",
        "像导演工作台上的精致分镜板，深色或浅色纸张均可，清晰网格、细线分隔、可读小字、电影化彩色缩略图。",
        "场景必须是彩色的，并尽量参考场景资产；角色可以简化，但必须用 C编号+名称+高对比色标记，不能分不清谁是谁。",
        "角色外观只取最显著身份符号：水果/物种颜色、体型、固定服装、关键道具、武器或工具。",
        "角色事实卡和参考图是身份最高依据；保持每个角色的物种/物体身份、固定造型、服装、轮廓和关键道具，不要发明新角色设计。",
        "C编号是强绑定身份：同一个 C编号在所有分镜卡里必须始终对应同一个角色，不能把 C1/C2/C3 的外形互换。",
        "分镜的构图动作线索只用于理解镜头、动作、场景和道具；若其中出现角色服装/外貌描述，与角色参考图或事实卡冲突时必须忽略。",
        "所有文字必须是清晰正常打印字，不要手写字、草绘字、潦草字或涂鸦字。",
        "所有可见文字统一使用中文；角色名、C编号和必要专有名词可保留原文。",
        "不要画成漫画页、海报或软件 UI 截图。",
        "",
        previousBoardReferenceNote,
        "",
        "项目信息：",
        `标题：${project.name || "未命名"}`,
        `工作区：${script.name || `script ${script.id}`}`,
        `导演板：${boardIndex + 1}/${totalBoards}`,
        `视频画幅比例：${project.videoRatio || "9:16"}`,
        `项目类型：${projectTypeText}`,
        `视觉风格：${visualStyleText}`,
        "",
        "角色图例：",
        referenceLines.length ? referenceLines.join("\n") : "无可用参考图。",
        "",
        "角色标签：",
        characterLabelLines.length ? characterLabelLines.join("\n") : "没有关联角色资产。请从分镜描述中推导临时 C编号，并在本张导演板内保持稳定。",
        "",
        "场景参考：",
        sceneLines.length ? sceneLines.join("\n") : "没有关联场景资产。只根据分镜描述构建场景。",
        "",
        "其他素材：",
        otherAssetLines.length ? otherAssetLines.join("\n") : "无其他素材。",
        "",
        "分镜卡内容：",
        shotLines.join("\n"),
      ].join("\n");
    }

    return [
      "生成一张横向 16:9 章节导演板，用于给视频模型参考。",
      "它不是最终画面，只表达本组镜头的空间、机位、角色位置、动作连续、灯光和节奏。",
      "必须严格使用下面的固定结构生成，不要自行改成其他版式。",
      "",
      "固定结构：",
      `顶部：短标题栏 “Chapter Director Board B${String(boardIndex + 1).padStart(2, "0")}”。`,
      "左侧：小参考图例，列出 C1/C2/C3 等角色和一个场景缩略区。",
      "中上：彩色俯视调度图，显示场景布局、角色位置、摄像机位置、运动箭头、视线和主要光源方向。",
      "中下：6 个连续分镜小格，按本组镜头顺序排列；镜头少于 6 个时留空位，不改变版式。",
      "右侧：简单动作流草图，显示镜头之间的位置变化。",
      "底部：短连续性备注，只写灯光、道具、机位和情绪。",
      "",
      "画面风格：",
      "彩色场景、浅色纸张背景、细黑分隔线、干净的导演标注。",
      "角色只画成简单铅笔/马克笔符号或剪影，不画精细脸部和最终角色立绘。",
      "每次角色出现都在旁边标 C编号+名称，例如 C1 Chloe；同一角色全图使用同一个高对比色标记。",
      "用最明显的身份符号区分角色：水果/物种颜色、体型、固定服装、关键道具、武器或工具。",
      "角色事实卡和角色参考图只用于识别身份符号；保持每个角色的物种/物体身份、固定造型、服装、轮廓和关键道具，不要发明新角色设计。",
      "C编号是强绑定身份：同一个 C编号在全图必须始终对应同一个角色，不能把 C1/C2/C3 的外形互换。",
      "覆盖镜头里的构图动作线索只用于理解镜头、动作、场景和道具；若其中出现角色服装/外貌描述，与角色参考图或事实卡冲突时必须忽略。",
      "场景参考图用于确定环境布局、色彩、入口、桌面、墙面、灯光和道具。",
      "画面文字保持简短可读，并统一使用中文；角色名、C编号和必要专有名词可保留原文。",
      "所有文字必须使用清晰正常打印字，不要手写字、草绘字、潦草字或涂鸦字。",
      "不要在图里写长段落；角色只用短标签：C1 名称、C2 名称、C3 名称。",
      "不要画成漫画页、海报或 UI 截图。",
      "",
      previousBoardReferenceNote,
      "",
      "按顺序使用附加参考图：",
      referenceLines.length ? referenceLines.join("\n") : "无可用参考图。",
      "",
      "角色短标签：",
      characterLabelLines.length ? characterLabelLines.join("\n") : "无角色参考；从分镜中提取临时 C编号。",
      "",
      "项目信息：",
      `标题：${project.name || "未命名"}`,
      `工作区：${script.name || `script ${script.id}`}`,
      `导演板：${boardIndex + 1}/${totalBoards}`,
      `视频画幅比例：${project.videoRatio || "9:16"}`,
      `项目类型：${projectTypeText}`,
      `视觉风格：${visualStyleText}`,
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

  if (boardType === "spatialSixPanel") {
    return [
      "Create one wide 16:9 visual chapter director board.",
      "Core requirement: one spatial map on top and one six-panel storyboard grid below. Keep the spatial map text-light, but every lower panel must include the shot action and dialogue.",
      "",
      "Fixed layout:",
      "Top half, about 40% of the image: a colored overhead spatial blocking map. Show the scene floor plan, entrances/exits, key props, main light direction, current character positions, character movement arrows, camera positions, and camera facing directions.",
      "Bottom half, about 60% of the image: exactly six storyboard panels in a 2 x 3 grid, ordered left to right and top to bottom. Each panel is a colored cinematic keyframe showing the shot composition, character action, and action change.",
      "Each lower storyboard panel must include two very short printed text strips at the bottom: Action: the core action for that panel; Dialogue: the dialogue snippet or 'No dialogue'. These two strips must be readable and must not be omitted.",
      "The spatial map and the six-panel grid must be inside the same single image. Spatial map on top, six-panel grid below. Do not change it into a left-right layout.",
      "",
      "Visible text restriction:",
      "No title bar, no explanatory paragraphs, no full storyboard tables, no large dialogue subtitles, no camera-setting text, no software UI screenshot, no watermark.",
      "In the spatial map, only tiny locator labels are allowed: C1/C2/C3, character names, shot numbers 1-6, arrow symbols, and small camera icons.",
      "In each six-grid panel, only these text items are allowed: shot number, C-number/character name, short Action strip, short Dialogue strip. Do not write any other words.",
      "If dialogue is too long, use the most important short phrase. If there is no dialogue, write 'No dialogue'. All text must be clean normal printed typography, not handwriting, sketch lettering, or doodle text.",
      "",
      "Characters and scene:",
      "Characters must stay distinguishable through high-contrast colors and C-number identity. They may be simplified, but preserve only the strongest identity symbols: fruit/species color, body scale, fixed outfit, key prop, weapon, or tool.",
      "Role fact cards and reference images are the highest identity authority. Do not invent new character appearances from shot descriptions. The same C-number must remain the same character in both the map and all six panels.",
      "The scene must be colored, readable, and spatially clear. Follow scene references for layout, colors, entrances, walls, lighting, and key props.",
      "",
      previousBoardReferenceNote,
      "",
      "Use the attached reference images in order:",
      referenceLines.length ? referenceLines.join("\n") : "No attached references.",
      "",
      "Character labels:",
      characterLabelLines.length ? characterLabelLines.join("\n") : "No role assets are linked. Derive temporary C-number labels from the storyboard descriptions and keep them stable across this board.",
      "",
      "Project information, for generation guidance only. Do not render this as visible text:",
      `title: ${project.name || "Untitled"}`,
      `workspace: ${script.name || `script ${script.id}`}`,
      `board: ${boardIndex + 1}/${totalBoards}`,
      `video aspect ratio: ${project.videoRatio || "9:16"}`,
      `project type: ${projectTypeText}`,
      `visual style: ${visualStyleText}`,
      "",
      "Scene references, for generation guidance only. Do not render this as visible text:",
      sceneLines.length ? sceneLines.join("\n") : "No scene asset is linked. Build a scene only from the storyboard descriptions.",
      "",
      "Other assets, for generation guidance only. Do not render this as visible text:",
      otherAssetLines.length ? otherAssetLines.join("\n") : "No other assets.",
      "",
      "Six-panel content:",
      "The 'visible action' field must be drawn as the character action in that panel. The 'visible dialogue' field must be printed in that panel's bottom Dialogue strip.",
      spatialSixPanelShotLines.join("\n"),
    ].join("\n");
  }

  if (boardType === "hybridStoryboard") {
    return [
      "Create one wide 16:9 hybrid chapter director board combining a spatial continuity board and a text storyboard sheet.",
      "Goal: the video model must understand scene space, character blocking, camera placement, movement, and the key text plan for every shot.",
      "Do not include an action-flow panel. No separate action-flow area is needed.",
      "",
      "Fixed layout:",
      `Top: printed title bar: "Hybrid Chapter Director Board B${String(boardIndex + 1).padStart(2, "0")}", plus project title, covered shot range, and total duration.`,
      "Left 35%: colored overhead blocking map. Show scene layout, entrances/exits, C-number character positions, camera positions, movement arrows, eye lines, key props, and main light direction.",
      "Right 65%: six vertical portrait storyboard cards in timeline order, arranged as a 2 x 3 grid. Each card has a colored keyframe thumbnail on top and a printed text table underneath.",
      "Bottom strip: short continuity notes for character position changes, light direction, prop state, and continuity from the previous board.",
      "",
      "Each card must include these printed fields:",
      "Shot / Time / Framing / Camera Move / Lens / Aperture / Shutter / ISO / Action / Dialogue or Sound.",
      "All text must be clean normal printed typography, readable sans-serif, black or dark gray. Do not use handwriting, sketch lettering, scribbles, or doodle text. The video model must be able to read it.",
      "",
      "Image style:",
      "Scenes must be colored, readable, and spatially clear. Follow scene references when available.",
      "Characters may be simplified as clean colored symbols or simple figures, but each character must be identifiable with C-number + name + high-contrast color marker.",
      "Use only the strongest character identity symbols: fruit/species color, body scale, fixed outfit, key prop, weapon, or tool.",
      "Role fact cards and role references are the highest authority for identity. Preserve each character's species/object identity, fixed outfit, silhouette, key prop, and final referenced design.",
      "C-number identity is binding: the same C-number must always be the same character across the whole board. Never swap C1/C2/C3 appearances.",
      "Covered-shot composition/action cues are only for camera, action, scene, and props. Ignore any clothing or appearance detail inside those cues if it conflicts with role references or role fact cards.",
      "Do not make a comic page, poster, software UI screenshot, or final video frame.",
      "",
      previousBoardReferenceNote,
      "",
      "Use the attached reference images in order:",
      referenceLines.length ? referenceLines.join("\n") : "No attached references.",
      "",
      "Character labels:",
      characterLabelLines.length ? characterLabelLines.join("\n") : "No role assets are linked. Derive temporary C-number labels from the storyboard descriptions and keep them stable across this board.",
      "",
      "Project:",
      `title: ${project.name || "Untitled"}`,
      `workspace: ${script.name || `script ${script.id}`}`,
      `board: ${boardIndex + 1}/${totalBoards}`,
      `video aspect ratio: ${project.videoRatio || "9:16"}`,
      `project type: ${projectTypeText}`,
      `visual style: ${visualStyleText}`,
      "",
      "Scene references:",
      sceneLines.length ? sceneLines.join("\n") : "No scene asset is linked. Build a scene only from the storyboard descriptions.",
      "",
      "Other assets:",
      otherAssetLines.length ? otherAssetLines.join("\n") : "No other assets.",
      "",
      "Storyboard card content:",
      shotLines.join("\n"),
    ].join("\n");
  }

  if (boardType === "textStoryboard") {
    return [
      "Create one wide 16:9 text-rich storyboard director board for video-generation and editing reference.",
      "This board should look like a professional shot-by-shot director storyboard sheet, not only an overhead blocking map. It may contain more text, but every word must be readable.",
      "",
      "Language rule:",
      "All visible text must be English only, including titles, table labels, shot descriptions, dialogue snippets, sound notes, continuity notes, scene labels, and warnings.",
      "Keep character names and C-number labels unchanged. Do not include Chinese text anywhere on the board.",
      "",
      "Layout:",
      "Top title bar: board number, total duration, covered shot range, and project title.",
      "Main body: exactly 6 vertical portrait storyboard cards in timeline order when six shots are available. If fewer than 6 shots are covered, leave empty slots instead of changing the wide 16:9 board ratio. Each card has a colored keyframe thumbnail on top and a structured text table underneath.",
      "Each card text fields: shot number, time/duration, framing, camera move, visual, characters/position, action, emotion, environment/lighting, sound, dialogue.",
      "Each card must also show camera technical settings: lens/focal length, aperture, shutter, and ISO.",
      "Bottom strip: continuity notes listing character position changes, important props, light direction, and identity-preservation rules.",
      "",
      "Image style:",
      "polished director's storyboard sheet on paper, clear grid, thin dividers, readable small typography, cinematic colored thumbnails.",
      "Scenes must be colored and should follow scene references. Characters may be simplified, but each character must be identifiable with C-number + name + high-contrast color marker.",
      "Use only the strongest character identity symbols: fruit/species color, body scale, fixed outfit, key prop, weapon, or tool.",
      "Role fact cards and role references are the highest authority for identity. Preserve each character's species/object identity, fixed outfit, silhouette, key prop, and final referenced design.",
      "C-number identity is binding: the same C-number must always be the same character across every storyboard card. Never swap C1/C2/C3 appearances.",
      "Storyboard composition/action cues are only for camera, action, scene, and props. Ignore any clothing or appearance detail inside those cues if it conflicts with role references or role fact cards.",
      "All text must use clean normal printed typography. Do not use handwriting, sketch lettering, scribbles, or doodle text.",
      "Do not make a comic page, poster, software UI screenshot, or final video frame.",
      "",
      previousBoardReferenceNote,
      "",
      "Project:",
      `title: ${project.name || "Untitled"}`,
      `workspace: ${script.name || `script ${script.id}`}`,
      `board: ${boardIndex + 1}/${totalBoards}`,
      `video aspect ratio: ${project.videoRatio || "9:16"}`,
      `project type: ${projectTypeText}`,
      `visual style: ${visualStyleText}`,
      "",
      "Character legend:",
      referenceLines.length ? referenceLines.join("\n") : "No attached references.",
      "",
      "Character labels:",
      characterLabelLines.length ? characterLabelLines.join("\n") : "No role assets are linked. Derive temporary C-number labels from the storyboard descriptions and keep them stable across this board.",
      "",
      "Scene references:",
      sceneLines.length ? sceneLines.join("\n") : "No scene asset is linked. Build a scene only from the storyboard descriptions.",
      "",
      "Other assets:",
      otherAssetLines.length ? otherAssetLines.join("\n") : "No other assets.",
      "",
      "Storyboard card content:",
      shotLines.join("\n"),
    ].join("\n");
  }

  return [
    "Create a clean cinematic chapter director board, single wide 16:9 image.",
    "This is a director planning board for AI video generation, not final character art. Keep characters as simple readable colored pencil figures, not polished portraits.",
    "Use the fixed layout below exactly. Do not redesign the board structure.",
    "",
    "Use the attached reference images in order:",
    referenceLines.length ? referenceLines.join("\n") : "No attached references.",
    "",
    "Board purpose:",
    "This board only explains blocking, camera, movement, lighting, props, and continuity for the video model.",
    "",
    "Layout:",
    `Top: short title bar: "Chapter Director Board B${String(boardIndex + 1).padStart(2, "0")}".`,
    "Left: small reference legend with C1/C2/C3 character labels and one scene thumbnail area.",
    "Center top: colored overhead blocking map, showing scene layout, character positions, camera positions, movement arrows, eye lines, and light direction.",
    "Center bottom: 6 storyboard panels for the covered shots in timeline order. If fewer than 6 shots are covered, leave empty slots instead of changing the structure.",
    "Right: simple action-flow sketches showing how positions change between shots.",
    "Bottom: short continuity notes for lighting, props, camera, and mood.",
    "",
    "Image style:",
    "Colored production storyboard sheet, pencil-and-marker planning look, thin black panel lines, light paper background, cinematic but simple.",
    "The environment should be colored and readable. Characters should be simplified but clearly identifiable by fruit shape, color, label, and prop.",
    "Use only short character labels: C1 Name, C2 Name, C3 Name. Do not write long paragraphs inside the image.",
    "All text must use clean normal printed typography, not handwriting or sketch lettering.",
    "All visible text must be English only. Do not use subtitles, UI, watermark, or dense text.",
    "Do not redesign the characters. Preserve each character's species/object identity, fixed outfit, silhouette, key prop, and final referenced design.",
    "C-number identity is binding: the same C-number must always be the same character across the whole board. Never swap C1/C2/C3 appearances.",
    "Covered-shot composition/action cues are only for camera, action, scene, and props. Ignore any clothing or appearance detail inside those cues if it conflicts with role references or role fact cards.",
    "",
    previousBoardReferenceNote,
    "",
    "Character labels:",
    characterLabelLines.length ? characterLabelLines.join("\n") : "No role assets are linked. Derive temporary C-number labels from the storyboard descriptions and keep them stable across this board.",
    "",
    "Project:",
    `title: ${project.name || "Untitled"}`,
    `workspace: ${script.name || `script ${script.id}`}`,
    `board: ${boardIndex + 1}/${totalBoards}`,
    `video aspect ratio: ${project.videoRatio || "9:16"}`,
    `project type: ${projectTypeText}`,
    `visual style: ${visualStyleText}`,
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

async function getPreviousDirectorBoardReference(projectId: number, scriptId: number, boardIndex: number) {
  if (boardIndex <= 0) return null;
  const previous = (await u
    .db("o_directorBoard")
    .where({ projectId, scriptId, state: "已完成" })
    .whereNotNull("filePath")
    .where("index", "<", boardIndex)
    .orderBy("index", "desc")
    .orderBy("id", "desc")
    .first()) as DirectorBoardRow | undefined;
  if (!previous?.filePath) return null;
  try {
    return { type: "image" as const, base64: await u.oss.getImageBase64(previous.filePath) };
  } catch {
    return null;
  }
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
    imageSize: DirectorBoardImageSize;
    boardIndex: number;
    usePreviousBoardReference: boolean;
  },
) {
  const { project, script, storyboards, assets, prompt, promptLanguage, model, imageSize, boardIndex, usePreviousBoardReference } = data;
  const savePath = `/${project.id}/directorBoard/${script.id}/${uuidv4()}.jpg`;
  try {
    await runDirectorBoardImageTaskWithRetry(rowId, async () => {
      const finalPrompt = await normalizeDirectorBoardPromptLanguage(prompt, promptLanguage);
      if (finalPrompt !== prompt) {
        await u.db("o_directorBoard").where("id", rowId).update({
          prompt: finalPrompt,
          updateTime: Date.now(),
        });
      }
      const previousBoardReference = usePreviousBoardReference ? await getPreviousDirectorBoardReference(project.id, script.id, boardIndex) : null;
      const referenceList = await getAssetReferenceImages(assets, previousBoardReference ? 11 : 12);
      if (previousBoardReference) referenceList.push(previousBoardReference);
      const image = await u.Ai.Image(model as `${string}:${string}`).run(
        {
          prompt: finalPrompt,
          referenceList,
          size: imageSize,
          aspectRatio: "16:9",
        },
        {
          taskClass: "章节导演板生成",
          describe: "章节导演板生成",
          relatedObjects: JSON.stringify({
            projectId: project.id,
            scriptId: script.id,
            directorBoardId: rowId,
            storyboardIds: storyboards.map((item) => item.id),
          }),
          projectId: project.id,
        },
      );
      await image.save(savePath);
    });
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
  const usePreviousBoardReference = options.usePreviousBoardReference === true;
  const model = clean(options.model || project.imageModel);
  const imageSize = normalizeDirectorBoardImageSize(options.imageSize || options.imageQuality, project.imageQuality);
  const boardType = normalizeDirectorBoardType(options.boardType);
  if (shouldGenerateImages && !model) throw new Error("项目未配置出图模型，无法生成章节导演板图片。");

  const baseQuery = u.db("o_storyboard").where({ projectId, scriptId });
  if (options.storyboardIds?.length) baseQuery.whereIn("id", options.storyboardIds);
  const storyboards = (await baseQuery
    .orderBy("index", "asc")
    .select("id", "index", "prompt", "videoDesc", "duration", "filePath", "trackId", "focalLength", "aperture", "shutterSpeed", "iso")) as StoryboardRow[];
  if (!storyboards.length) throw new Error("当前章节没有可用于导演板的分镜。");

  const shotsPerBoard = Math.min(Math.max(Number(options.shotsPerBoard || 6), 1), 8);
  const chunks = chunkStoryboardsForDirectorBoards(storyboards, {
    maxDuration: boardType === "textStoryboard" ? Number.POSITIVE_INFINITY : MAX_DIRECTOR_BOARD_DURATION_SECONDS,
    maxShots: shotsPerBoard,
  });
  if (options.replace !== false) {
    await u.db("o_directorBoard").where({ projectId, scriptId }).delete();
  }

  const created: DirectorBoardRow[] = [];
  const imageTasks: Array<{
    rowId: number;
    project: ProjectRow;
    script: ScriptRow;
    storyboards: StoryboardRow[];
    assets: AssetRow[];
    prompt: string;
    promptLanguage: DirectorBoardPromptLanguage;
    model: string;
    imageSize: DirectorBoardImageSize;
    boardIndex: number;
    usePreviousBoardReference: boolean;
  }> = [];
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
      boardType,
      usePreviousBoardReference,
    });
    const [rowId] = await u.db("o_directorBoard").insert({
      projectId,
      scriptId,
      name: `${directorBoardTypeName(boardType)} ${boardIndex + 1}/${chunks.length}`,
      prompt,
      state: shouldGenerateImages ? "生成中" : "未生成",
      reason: "",
      model,
      boardType,
      storyboardIds: safeJson(chunk.map((item) => item.id)),
      assetIds: safeJson(assets.map((item) => item.id)),
      index: boardIndex,
      createTime: Date.now() + boardIndex,
      updateTime: Date.now(),
    });
    const row = (await u.db("o_directorBoard").where("id", rowId).first()) as DirectorBoardRow;
    created.push(row);
    if (shouldGenerateImages) {
      imageTasks.push({ rowId: Number(rowId), project, script, storyboards: chunk, assets, prompt, promptLanguage, model, imageSize, boardIndex, usePreviousBoardReference });
    }
  }

  if (imageTasks.length) {
    void (async () => {
      for (const task of imageTasks) {
        await runDirectorBoardImageTask(task.rowId, task);
      }
    })();
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
    .select("id", "index", "prompt", "videoDesc", "duration", "filePath", "trackId", "focalLength", "aperture", "shutterSpeed", "iso")) as StoryboardRow[];
  if (!storyboards.length) throw new Error("该章节导演板对应的分镜不存在，无法重绘。");

  const totalBoardsRow = (await u.db("o_directorBoard").where({ projectId, scriptId }).count({ count: "id" }).first()) as { count?: number | string } | undefined;
  const totalBoards = Math.max(1, Number(totalBoardsRow?.count || 1));
  const boardIndex = Number.isFinite(Number(row.index)) ? Number(row.index) : 0;
  const assets = await getStoryboardAssets(projectId, storyboards.map((item) => item.id));
  const promptLanguage = detectDirectorBoardPromptLanguage({ project, script, storyboards });
  const boardType = normalizeDirectorBoardType(options.boardType || row.boardType);
  const imageSize = normalizeDirectorBoardImageSize(options.imageSize || options.imageQuality, project.imageQuality);
  const usePreviousBoardReference = options.usePreviousBoardReference === true;
  const prompt = buildChapterDirectorBoardPrompt({
    project,
    script,
    boardIndex,
    totalBoards,
    storyboards,
    assets,
    language: promptLanguage,
    boardType,
    usePreviousBoardReference,
  });
  const model = clean(options.model || project.imageModel || row.model);
  if (!model) throw new Error("项目未配置出图模型，无法重绘章节导演板。");

  await u.db("o_directorBoard").where("id", boardId).update({
    name: `${directorBoardTypeName(boardType)} ${boardIndex + 1}/${totalBoards}`,
    prompt,
    filePath: null,
    state: "生成中",
    reason: "",
    model,
    boardType,
    assetIds: safeJson(assets.map((item) => item.id)),
    updateTime: Date.now(),
  });

  void runDirectorBoardImageTask(boardId, { project, script, storyboards, assets, prompt, promptLanguage, model, imageSize, boardIndex, usePreviousBoardReference });
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
