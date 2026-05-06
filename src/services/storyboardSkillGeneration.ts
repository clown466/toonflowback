import u from "@/utils";
import {
  AssetRow,
  GenerateProjectStoryboardDraftOptions,
  GenerateProjectStoryboardDraftResult,
  NovelRow,
  ProjectRow,
  StoryboardDraftItem,
  assetDescription,
  assetImageMarkdown,
  buildStructuredVideoDesc,
  buildStoryboardPrompt,
  buildStoryboardTable,
  cleanName,
  compactText,
  deleteStoryboards,
  ensureProductionScript,
  formatChapterSelectionLabel,
  generateProjectStoryboardDraft,
  insertDraftItems,
  matchAssets,
  nonEmpty,
  parseStoryboardChapterIndexes,
  selectStoryboardNovels,
  shouldAppend,
  shouldForce,
  summarizeReference,
  toPublicWorkspaceName,
  toUniquePositiveNumbers,
  upsertProductionWorkData,
} from "@/services/storyboardDraftGeneration";

declare const require: any;

interface StoryboardGenerationSkill {
  id: string;
  name: string;
  description?: string;
  content: string;
}

interface SkillShot {
  duration: number;
  videoDesc: string;
  imagePrompt: string;
  associateAssetNames: string[];
  shouldGenerateImage: boolean;
  narrativeFunction?: string;
  pictureDescription?: string;
  role1?: string;
  role1Description?: string;
  role2?: string;
  role2Description?: string;
  reference?: string;
  scene?: string;
  shotSize?: string;
  cameraMove?: string;
  action?: string;
  emotion?: string;
  lighting?: string;
  sound?: string;
  dialogue?: string;
  beat?: string;
  videoMotionPrompt?: string;
}

interface SkillStoryboardJson {
  storyboardTable: string;
  shots: SkillShot[];
}

interface StoryboardPlanningHint {
  explicitShotCount?: number;
  estimatedMinimumShots: number;
  estimatedMinimumDuration: number;
  sourceDialogueSeconds: number;
  sourceDialogueText: string;
  eventCount: number;
}

export interface GenerateProjectStoryboardWithSkillOptions extends GenerateProjectStoryboardDraftOptions {
  skillId?: string;
  userRequirement?: string;
}

const DEFAULT_STORYBOARD_SKILL: StoryboardGenerationSkill = {
  id: "default_storyboard_text_generation",
  name: "Flova 结构化分镜生成方法",
  description: "从章节事件推理分镜表，再逐行生成可生产镜头",
  content: [
    "# Flova 结构化分镜生成方法",
    "你是动画短剧分镜导演。你的任务不是写知识总结，而是从选中章节推理出可生产的分镜表。",
    "",
    "固定流程：",
    "1. 只读取 selectedChapters 中的 event 和 chapterData，禁止引用未选章节。",
    "2. 先抽取事件节拍：地点、角色、动作目标、冲突/信息点、情绪变化、关键道具。",
    "3. 按事件复杂度决定镜头数量：未指定数量时不要默认 3 个；标准章节通常 6-12 个。",
    "4. 先生成 storyboardTable，字段固定为：镜号、时长、画面描述、角色1、角色描述1、角色图1、角色2、角色描述2、角色图2、参考、景别、角色动作、情绪、场景标签、光影氛围、音效、对白、分镜提示词、视频运动提示词。",
    "5. 再把分镜表逐行转换为 shots，shots.length 必须等于 storyboardTable 数据行数。",
    "",
    "每条 shot 必须能直接写入生产分镜：videoDesc 写完整视频描述，imagePrompt 写关键帧图像提示词，associateAssetNames 只能填写资产库中已存在的名称。",
  ].join("\n"),
};

const BASE_STORYBOARD_METHOD_PROMPT = DEFAULT_STORYBOARD_SKILL.content;
const MAX_STORYBOARD_SHOTS = 40;
const MAX_VIDEO_SHOT_DURATION = 15;
const ENGLISH_NORMAL_WORDS_PER_SECOND = 2.5;
const ENGLISH_FAST_WORDS_PER_SECOND = 3;
const ENGLISH_SLOW_WORDS_PER_SECOND = 2;
const CJK_NORMAL_CHARS_PER_SECOND = 3;
const CJK_FAST_CHARS_PER_SECOND = 4;
const CJK_SLOW_CHARS_PER_SECOND = 2;
const STORYBOARD_MODEL_KEY = "productionAgent:storyboardTableAgent";
const MAX_MODEL_CONTEXT_ASSETS = 12;
const MAX_STORYBOARD_SKILL_PROMPT_CHARS = 4200;

function fallback(projectId: number, options: GenerateProjectStoryboardWithSkillOptions, reason: string) {
  return generateProjectStoryboardDraft(projectId, options).then((result) => ({
    ...result,
    fallbackReason: result.fallbackReason ?? reason,
  }));
}

function stopStructuredStoryboardWrite(reason: string): never {
  throw new Error(`结构化分镜生成失败：${reason}。已停止写入，避免生成三段式模板分镜。需要低保真占位稿时，请明确使用“快速草稿”。`);
}

async function resolveStoryboardSkill(skillId?: string, requestText?: string): Promise<StoryboardGenerationSkill | null> {
  try {
    const service = require("@/services/storyboardGenerationSkill");
    if (skillId && typeof service.getStoryboardGenerationSkill === "function") {
      return await service.getStoryboardGenerationSkill(skillId);
    }
    if (typeof service.resolveStoryboardGenerationSkill === "function") {
      const resolved = await service.resolveStoryboardGenerationSkill({ skillId, requestText });
      if (resolved) return resolved;
    }
    if (typeof service.listStoryboardGenerationSkills === "function") {
      const skills = await service.listStoryboardGenerationSkills();
      const selected = skillId
        ? skills.find((skill: any) => skill.id === skillId)
        : skills.find((skill: any) => skill.path === "production_skills/storyboard_generation_method.md" || skill.id === "production_skills__storyboard_generation_method") ?? skills[0];
      if (selected?.id && typeof service.getStoryboardGenerationSkill === "function") return await service.getStoryboardGenerationSkill(selected.id);
      if (selected?.content) return selected;
    }
  } catch {
    // Worker A owns the CRUD service; use the built-in compatibility skill until it exists.
  }
  return skillId ? { ...DEFAULT_STORYBOARD_SKILL, id: skillId, name: skillId } : DEFAULT_STORYBOARD_SKILL;
}

function extractJsonText(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function parseStoryboardJson(text: string): SkillStoryboardJson {
  let parsed: any;
  try {
    parsed = JSON.parse(extractJsonText(text));
  } catch {
    throw new Error("模型未返回合法 JSON");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("模型 JSON 必须是对象");
  const shots = Array.isArray(parsed.shots) ? parsed.shots : Array.isArray(parsed.storyboard) ? parsed.storyboard : [];
  if (!shots.length) throw new Error("模型 JSON 缺少 shots[]");
  const normalizedShots = shots.map((shot: any, index: number): SkillShot => {
    const videoDesc = nonEmpty(shot.videoDesc) ?? nonEmpty(shot.videoDescription) ?? nonEmpty(shot.action);
    const imagePrompt = nonEmpty(shot.imagePrompt) ?? nonEmpty(shot.prompt);
    if (!videoDesc) throw new Error(`第 ${index + 1} 个镜头缺少 videoDesc`);
    if (!imagePrompt) throw new Error(`第 ${index + 1} 个镜头缺少 imagePrompt`);
    const duration = Number(shot.duration);
    return {
      duration: Number.isFinite(duration) && duration > 0 ? Math.min(Math.max(Math.round(duration), 1), MAX_VIDEO_SHOT_DURATION) : 4,
      videoDesc,
      imagePrompt,
      associateAssetNames: Array.isArray(shot.associateAssetNames)
        ? shot.associateAssetNames.map((name: unknown) => cleanName(name)).filter(Boolean)
        : [],
      shouldGenerateImage: shot.shouldGenerateImage == null ? true : Boolean(shot.shouldGenerateImage),
      narrativeFunction: nonEmpty(shot.narrativeFunction) ?? nonEmpty(shot.function) ?? nonEmpty(shot.beat),
      pictureDescription: nonEmpty(shot.pictureDescription) ?? nonEmpty(shot.description) ?? nonEmpty(shot.imageDescription),
      role1: nonEmpty(shot.role1),
      role1Description: nonEmpty(shot.role1Description),
      role2: nonEmpty(shot.role2),
      role2Description: nonEmpty(shot.role2Description),
      reference: Array.isArray(shot.reference) ? shot.reference.map((item: unknown) => cleanName(item)).filter(Boolean).join("、") : nonEmpty(shot.reference),
      scene: nonEmpty(shot.scene),
      shotSize: nonEmpty(shot.shotSize),
      cameraMove: nonEmpty(shot.cameraMove),
      action: nonEmpty(shot.action),
      emotion: nonEmpty(shot.emotion),
      lighting: nonEmpty(shot.lighting),
      sound: nonEmpty(shot.sound) ?? nonEmpty(shot.audio),
      dialogue: nonEmpty(shot.dialogue) ?? nonEmpty(shot.lines),
      beat: nonEmpty(shot.beat),
      videoMotionPrompt: nonEmpty(shot.videoMotionPrompt) ?? nonEmpty(shot.motionPrompt),
    };
  });
  return {
    storyboardTable: nonEmpty(parsed.storyboardTable) ?? "",
    shots: normalizedShots.slice(0, MAX_STORYBOARD_SHOTS),
  };
}

function parseSimpleCount(value: string) {
  if (/^\d+$/.test(value)) return Number(value);
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  if (value === "十") return 10;
  const tenIndex = value.indexOf("十");
  if (tenIndex >= 0) {
    const left = value.slice(0, tenIndex);
    const right = value.slice(tenIndex + 1);
    return (left ? digits[left] ?? 0 : 1) * 10 + (right ? digits[right] ?? 0 : 0);
  }
  return digits[value] ?? 0;
}

function parseRequestedShotCount(text?: string | null) {
  if (!text) return undefined;
  const match = text.match(/(?:前\s*)?([一二两三四五六七八九十\d]{1,3})\s*(?:个|张|条)?\s*(?:分镜|镜头|场景|画面|shots?|scenes?)/i);
  if (!match?.[1]) return undefined;
  const count = parseSimpleCount(match[1]);
  return Number.isFinite(count) && count > 0 && count <= 40 ? count : undefined;
}

function countEventRows(event?: string | null) {
  if (!event) return 0;
  const rows = event
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^[-|:\s]+$/.test(line) && !/事件|角色|章节|chapter|---/.test(line));
  return rows.length;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function uniqueTextParts(parts: string[]) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const text = part.replace(/\s+/g, " ").trim();
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    result.push(text);
  }
  return result;
}

function stripSpeakerLabels(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]?\s*[\w\u4e00-\u9fa5 .'"’‘-]{1,36}\s*[:：]\s*/, "").trim())
    .join("\n");
}

function isNoDialogueText(text: string) {
  return /^(?:无台词|无对白|无|none|no dialogue|no lines|n\/a|-)+$/i.test(text.replace(/\s+/g, " ").trim());
}

function extractDialogueFromSource(text: string) {
  const source = String(text ?? "");
  const parts: string[] = [];
  const quotePatterns = [
    /[「『“]([^「」『』“”]{2,800})[」』”]/g,
    /"([^"\n]{2,800})"/g,
  ];
  for (const pattern of quotePatterns) {
    for (const match of source.matchAll(pattern)) {
      const value = stripSpeakerLabels(match[1] ?? "").trim();
      if (value && !isNoDialogueText(value)) parts.push(value);
    }
  }

  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*[-*]?\s*[\w\u4e00-\u9fa5 .'"’‘-]{1,36}\s*[:：]\s*(.{2,800})$/);
    if (!match?.[1]) continue;
    const value = match[1].trim();
    if (value && !isNoDialogueText(value) && !/^\|?\s*(?:事件|角色|章节|chapter|scene|shot|镜号)\b/i.test(value)) parts.push(value);
  }

  return uniqueTextParts(parts).join("\n");
}

function getSpeechRates(emotion?: string | null) {
  const text = String(emotion ?? "").toLowerCase();
  if (/怒|急|吼|喊|争吵|惊慌|慌乱|panic|angry|furious|shout|yell|argue|urgent/.test(text)) {
    return { englishWordsPerSecond: ENGLISH_FAST_WORDS_PER_SECOND, cjkCharsPerSecond: CJK_FAST_CHARS_PER_SECOND };
  }
  if (/悲|哭|低语|虚弱|临终|沉思|哽咽|sad|whisper|weak|dying|cry|soft/.test(text)) {
    return { englishWordsPerSecond: ENGLISH_SLOW_WORDS_PER_SECOND, cjkCharsPerSecond: CJK_SLOW_CHARS_PER_SECOND };
  }
  return { englishWordsPerSecond: ENGLISH_NORMAL_WORDS_PER_SECOND, cjkCharsPerSecond: CJK_NORMAL_CHARS_PER_SECOND };
}

function estimateSpeechDurationSeconds(text: string, emotion?: string | null) {
  const dialogue = stripSpeakerLabels(String(text ?? "").replace(/\([^)]*\)/g, " ").replace(/（[^）]*）/g, " ")).trim();
  if (!dialogue || isNoDialogueText(dialogue)) return 0;
  const englishWords = dialogue.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)?/g)?.length ?? 0;
  const cjkChars = dialogue.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  if (!englishWords && !cjkChars) return 0;
  const punctuationCount = dialogue.match(/[,.!?;:，。！？；：…]+/g)?.length ?? 0;
  const rates = getSpeechRates(emotion);
  const spokenSeconds = englishWords / rates.englishWordsPerSecond + cjkChars / rates.cjkCharsPerSecond;
  const pauseSeconds = Math.min(punctuationCount * 0.35, 4);
  return Math.ceil(spokenSeconds + pauseSeconds + 1);
}

function extractShotDialogueText(shot: SkillShot) {
  const dialogue = nonEmpty(shot.dialogue);
  if (dialogue && !isNoDialogueText(dialogue)) return dialogue;
  return "";
}

function getSourceDialogue(novels: NovelRow[]) {
  const text = novels
    .map((novel) => [novel.event, novel.chapterData].filter(Boolean).join("\n"))
    .filter(Boolean)
    .join("\n\n");
  return extractDialogueFromSource(text);
}

function buildPlanningHint(novels: NovelRow[], sourceText?: string | null): StoryboardPlanningHint {
  const explicitShotCount = parseRequestedShotCount(sourceText);
  const eventCount = novels.reduce((sum, novel) => sum + countEventRows(novel.event), 0);
  const textLength = novels.reduce((sum, novel) => sum + String(novel.chapterData ?? "").length, 0);
  const sourceDialogueText = getSourceDialogue(novels);
  const sourceDialogueSeconds = estimateSpeechDurationSeconds(sourceDialogueText);
  const dialogueShotFloor = sourceDialogueSeconds > 0 ? Math.ceil(sourceDialogueSeconds / 8) : 0;
  const estimatedMinimumShots = explicitShotCount ?? clamp(Math.max(4, eventCount * 2, Math.ceil(textLength / 700), dialogueShotFloor), 4, 16);
  const estimatedMinimumDuration = sourceDialogueSeconds > 0 ? Math.ceil(sourceDialogueSeconds * 0.9) : 0;
  return {
    explicitShotCount,
    estimatedMinimumShots,
    estimatedMinimumDuration,
    sourceDialogueSeconds,
    sourceDialogueText: compactText(sourceDialogueText, 1000),
    eventCount,
  };
}

function assetNameKey(value: unknown) {
  return cleanName(value).toLowerCase();
}

function mapAssetNamesToIds(assets: AssetRow[], names: string[]) {
  const byName = new Map(assets.map((asset) => [assetNameKey(asset.name), asset.id]));
  const ids: number[] = [];
  for (const name of names) {
    const exactId = byName.get(assetNameKey(name));
    if (exactId && !ids.includes(exactId)) {
      ids.push(exactId);
      continue;
    }
    const normalizedName = assetNameKey(name);
    const fuzzy = assets.find((asset) => {
      const assetName = assetNameKey(asset.name);
      return assetName && normalizedName && (assetName.includes(normalizedName) || normalizedName.includes(assetName));
    });
    if (fuzzy?.id && !ids.includes(fuzzy.id)) ids.push(fuzzy.id);
  }
  return ids;
}

function selectModelContextAssets(project: ProjectRow, novels: NovelRow[], assets: AssetRow[], userRequirement?: string) {
  const sourceText = [
    project.intro,
    project.artStyle,
    project.directorManual,
    userRequirement,
    ...novels.flatMap((novel) => [novel.chapter, novel.event, novel.chapterData]),
  ]
    .filter(Boolean)
    .join("\n");
  return matchAssets(assets, sourceText, MAX_MODEL_CONTEXT_ASSETS);
}

function buildModelContext(project: ProjectRow, novels: NovelRow[], assets: AssetRow[], scriptContent: string, userRequirement?: string) {
  const planning = buildPlanningHint(novels, userRequirement);
  const contextAssets = selectModelContextAssets(project, novels, assets, userRequirement);
  const selectedChapters = novels.map((novel) => ({
    id: novel.id,
    chapterIndex: novel.chapterIndex,
    chapter: novel.chapter,
    event: novel.event,
    chapterData: compactText(novel.chapterData, 2600),
  }));
  return {
    project: {
      id: project.id,
      name: project.name,
      intro: compactText(project.intro, 800),
      type: project.type,
      artStyle: project.artStyle,
      directorManual: compactText(project.directorManual, 1600),
      videoRatio: project.videoRatio,
    },
    visualManual: compactText([project.artStyle, project.directorManual].filter(Boolean).join("\n\n"), 1800),
    selectedChapters,
    scriptContent: novels.length ? undefined : compactText(scriptContent, 4200),
    assets: contextAssets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      describe: compactText(asset.describe, 160),
      prompt: compactText(asset.prompt, 180),
    })),
    assetSelection: {
      providedCount: contextAssets.length,
      totalCount: assets.length,
      note: "仅提供与当前章节最相关的资产；associateAssetNames 只能从 assets[].name 中选择。",
    },
    userRequirement,
    storyboardPlanning: planning,
  };
}

function toDraftItems(project: ProjectRow, parsed: SkillStoryboardJson, assets: AssetRow[]): StoryboardDraftItem[] {
  return parsed.shots.map((shot, index) => {
    const ids = mapAssetNamesToIds(assets, shot.associateAssetNames);
    const associatedAssets = ids.length ? assets.filter((asset) => ids.includes(asset.id)) : matchAssets(assets, `${shot.videoDesc}\n${shot.imagePrompt}`, 7);
    const assetNames = associatedAssets.map((asset) => cleanName(asset.name)).filter(Boolean);
    const roleAssets = associatedAssets.filter((asset) => asset.type === "role");
    const sceneAssets = associatedAssets.filter((asset) => asset.type === "scene");
    const propAssets = associatedAssets.filter((asset) => asset.type === "tool");
    const role1Asset = roleAssets.find((asset) => assetNameKey(asset.name) === assetNameKey(shot.role1)) ?? roleAssets[0];
    const role2Asset = roleAssets.find((asset) => assetNameKey(asset.name) === assetNameKey(shot.role2)) ?? roleAssets.find((asset) => asset.id !== role1Asset?.id);
    const scene = shot.scene ?? cleanName(sceneAssets[0]?.name);
    const itemBase: StoryboardDraftItem = {
      index,
      duration: shot.duration,
      track: "主线分镜",
      videoDesc: shot.videoDesc,
      prompt: "",
      shouldGenerateImage: shot.shouldGenerateImage ? 1 : 0,
      associateAssetsIds: associatedAssets.map((asset) => asset.id),
      sourceTitle: shot.beat ?? shot.scene ?? `镜头 ${index + 1}`,
      narrativeFunction: shot.narrativeFunction ?? shot.beat,
      pictureDescription: shot.pictureDescription ?? shot.action ?? shot.videoDesc,
      role1: shot.role1 ?? cleanName(role1Asset?.name),
      role1Description: shot.role1Description ?? assetDescription(role1Asset),
      role1Image: assetImageMarkdown(role1Asset),
      role2: shot.role2 ?? cleanName(role2Asset?.name),
      role2Description: shot.role2Description ?? assetDescription(role2Asset),
      role2Image: assetImageMarkdown(role2Asset),
      reference: shot.reference ?? summarizeReference([...sceneAssets, ...propAssets]),
      shotSize: shot.shotSize,
      cameraMove: shot.cameraMove,
      action: shot.action,
      emotion: shot.emotion,
      scene,
      lighting: shot.lighting,
      sound: shot.sound,
      dialogue: shot.dialogue ?? "无台词",
      videoMotionPrompt: shot.videoMotionPrompt,
    };
    const videoDesc = shot.videoDesc || buildStructuredVideoDesc(itemBase);
    const prompt = shot.imagePrompt || buildStoryboardPrompt(project, videoDesc, assetNames);
    return {
      ...itemBase,
      videoDesc,
      prompt,
      videoMotionPrompt: itemBase.videoMotionPrompt ?? `${shot.shotSize ?? ""} ${shot.cameraMove ?? ""} ${shot.action ?? shot.videoDesc}`.trim(),
    };
  });
}

function normalizeStoryboardTimings(parsed: SkillStoryboardJson): SkillStoryboardJson {
  return {
    ...parsed,
    shots: parsed.shots.map((shot) => {
      const dialogueDuration = estimateSpeechDurationSeconds(extractShotDialogueText(shot), shot.emotion);
      const duration = Math.min(Math.max(shot.duration, dialogueDuration || 1), MAX_VIDEO_SHOT_DURATION);
      return { ...shot, duration };
    }),
  };
}

function getTotalDuration(parsed: SkillStoryboardJson) {
  return parsed.shots.reduce((sum, shot) => sum + shot.duration, 0);
}

function getOutputDialogueSeconds(parsed: SkillStoryboardJson) {
  const text = parsed.shots.map(extractShotDialogueText).filter(Boolean).join("\n");
  return estimateSpeechDurationSeconds(text);
}

function findOversizedDialogueShot(parsed: SkillStoryboardJson) {
  for (const [index, shot] of parsed.shots.entries()) {
    const dialogueDuration = estimateSpeechDurationSeconds(extractShotDialogueText(shot), shot.emotion);
    if (dialogueDuration > MAX_VIDEO_SHOT_DURATION) {
      return { index: index + 1, dialogueDuration };
    }
  }
  return null;
}

function storyboardCountInstruction(planning?: StoryboardPlanningHint) {
  if (planning?.explicitShotCount) {
    return `用户明确要求数量：必须输出 ${planning.explicitShotCount} 个分镜；storyboardTable 数据行数和 shots.length 都必须等于 ${planning.explicitShotCount}。`;
  }
  return [
    `用户未明确限定数量：不要默认生成 3 个分镜，也不要为了省事只生成 3 个。`,
    `请先按章节事件拆分完整分镜表，再由分镜表逐行生成 shots。当前建议不少于 ${planning?.estimatedMinimumShots ?? 4} 个分镜；除非原文极短，否则单章通常应为 6-12 个分镜。`,
    `如果只返回 3 个分镜，会被视为拆镜不足。`,
  ].join("\n");
}

function validateStoryboardQuality(parsed: SkillStoryboardJson, planning?: StoryboardPlanningHint) {
  const count = parsed.shots.length;
  if (planning?.explicitShotCount && count !== planning.explicitShotCount) return `用户要求 ${planning.explicitShotCount} 个分镜，你返回了 ${count} 个`;

  if (!planning?.explicitShotCount && count < (planning?.estimatedMinimumShots ?? 4)) {
    return `分镜拆分不足：当前 ${count} 个，按事件和对白长度建议不少于 ${planning?.estimatedMinimumShots ?? 4} 个`;
  }

  const oversized = findOversizedDialogueShot(parsed);
  if (oversized) {
    return `第 ${oversized.index} 镜对白预计需要 ${oversized.dialogueDuration}s，超过单条视频镜头 ${MAX_VIDEO_SHOT_DURATION}s 上限，必须把对白拆到多个镜头`;
  }

  if (planning?.estimatedMinimumDuration && getTotalDuration(parsed) < planning.estimatedMinimumDuration) {
    return `总时长过短：当前 ${getTotalDuration(parsed)}s，选中章节对白至少需要约 ${planning.estimatedMinimumDuration}s`;
  }

  if (planning?.sourceDialogueSeconds && planning.sourceDialogueSeconds >= 8 && getOutputDialogueSeconds(parsed) < planning.sourceDialogueSeconds * 0.6) {
    return `输出对白覆盖不足：选中章节对白约 ${planning.sourceDialogueSeconds}s，但分镜对白字段明显缺失，必须保留原文对白`;
  }

  return "";
}

async function invokeStoryboardModel(skill: StoryboardGenerationSkill, context: Record<string, any>, retryReason?: string) {
  const planning = context.storyboardPlanning as StoryboardPlanningHint | undefined;
  const skillContent = compactText(skill.content, MAX_STORYBOARD_SKILL_PROMPT_CHARS);
  const prompt = [
    BASE_STORYBOARD_METHOD_PROMPT,
    "",
    "选中的分镜方法 / 附加约束：",
    skillContent,
    "",
    "核心流程：",
    "1. 先阅读 selectedChapters 中的 event 和 chapterData，只处理这些章节。",
    "2. 先生成 storyboardTable，表中每一行代表一个真实分镜；为节省模型输出，最终 JSON 的 storyboardTable 字段可以填空字符串，系统会用 shots 字段重建表格。",
    "3. 再按 storyboardTable 逐行生成 shots；shots.length 必须等于 storyboardTable 的数据行数。",
    "4. 每个 shot 必须有 videoDesc 和 imagePrompt，且两者不能只是复制同一句话。",
    "5. storyboardTable 固定使用这些字段：镜号、时长、画面描述、角色1、角色描述1、角色图1、角色2、角色描述2、角色图2、参考、景别、角色动作、情绪、场景标签、光影氛围、音效、对白、分镜提示词、视频运动提示词。",
    "6. 角色图字段可先填空；系统会按 associateAssetNames 匹配资产库图片补齐显示。",
    `7. 含对白镜头必须按可听懂语速估算时长：英文正常约 2-2.5 words/sec，短剧急促对白也不应超过约 3 words/sec；中文正常约 3 字/秒。每条视频镜头 duration 不超过 ${MAX_VIDEO_SHOT_DURATION}s，超出必须拆成多镜头。`,
    planning?.sourceDialogueSeconds ? `8. 当前选中章节原文对白预计至少需要约 ${planning.sourceDialogueSeconds}s；总分镜时长不能明显低于这个值，且对白必须进入 dialogue 字段。` : "",
    storyboardCountInstruction(planning),
    retryReason ? `上一次输出不合格：${retryReason}。请重新拆分，不要沿用上一次数量。` : "",
    "",
    "输出要求：只返回 JSON，不要 Markdown，不要解释。",
    "JSON schema:",
    JSON.stringify(
      {
        storyboardTable: "",
        shots: [
          {
            duration: 4,
            videoDesc: "画面、动作、调度",
            imagePrompt: "关键帧图像提示词",
            associateAssetNames: ["资产名称"],
            shouldGenerateImage: true,
            narrativeFunction: "定场/动作推进/情绪反应/信息揭示等",
            pictureDescription: "表格里的画面描述",
            role1: "画面中第一个主要角色名",
            role1Description: "该角色在本镜的状态，不要违背资产图",
            role2: "画面中第二个主要角色名，可空",
            role2Description: "该角色在本镜的状态，可空",
            reference: "场景/道具/参考资产名称",
            scene: "可选",
            shotSize: "可选",
            cameraMove: "可选",
            action: "可选",
            emotion: "可选",
            lighting: "可选",
            sound: "环境音/动作音",
            dialogue: "对白原文或无台词",
            beat: "可选",
            videoMotionPrompt: "用于视频生成的运动提示词",
          },
        ],
      },
      null,
      2,
    ),
    "",
    "上下文 JSON:",
    JSON.stringify(context, null, 2),
  ].join("\n");
  const result = await u.Ai.Text(STORYBOARD_MODEL_KEY).invoke({ prompt });
  const text = (result as any)?.text ?? (result as any)?._output ?? "";
  if (!nonEmpty(text)) throw new Error("模型未返回文本");
  return parseStoryboardJson(String(text));
}

export async function generateProjectStoryboardWithSkill(
  projectId: number,
  options: GenerateProjectStoryboardWithSkillOptions = {},
): Promise<GenerateProjectStoryboardDraftResult> {
  const sourceText = options.sourceText ?? options.userRequirement;
  if (/快速草稿/i.test(sourceText ?? "")) return fallback(projectId, { ...options, sourceText }, "用户要求快速草稿，直接使用旧模板生成器");

  const project = (await u.db("o_project").where("id", projectId).first()) as ProjectRow | undefined;
  if (!project?.id) throw new Error("当前项目不存在，无法生成分镜。");

  const [allNovels, assets] = await Promise.all([
    u.db("o_novel").where("projectId", projectId).select("id", "chapterIndex", "chapter", "chapterData", "event", "eventState").orderBy("chapterIndex", "asc") as Promise<NovelRow[]>,
    u
      .db("o_assets")
      .leftJoin("o_image", "o_assets.imageId", "o_image.id")
      .where("o_assets.projectId", projectId)
      .whereNull("o_assets.assetsId")
      .select("o_assets.id", "o_assets.name", "o_assets.type", "o_assets.describe", "o_assets.prompt", "o_assets.imageId", "o_image.filePath")
      .orderByRaw(`CASE o_assets.type WHEN 'scene' THEN 1 WHEN 'role' THEN 2 WHEN 'tool' THEN 3 ELSE 4 END`)
      .orderBy("o_assets.id", "asc") as Promise<AssetRow[]>,
  ]);
  const requestedChapterIndexes = toUniquePositiveNumbers([...(options.chapterIndexes ?? []), ...parseStoryboardChapterIndexes(sourceText)]);
  const requestedNovelIds = toUniquePositiveNumbers(options.novelIds ?? []);
  const novels = selectStoryboardNovels(allNovels, { ...options, sourceText });
  if (allNovels.length && (requestedChapterIndexes.length || requestedNovelIds.length) && !novels.length) {
    throw new Error(`没有匹配到指定章节，已停止生成，避免把其他章节误写入分镜。`);
  }

  const force = options.force ?? shouldForce(sourceText);
  const append = options.append ?? shouldAppend(sourceText);
  const { script, created: scriptCreated, content: scriptContent } = await ensureProductionScript(project, novels, options.preferredScriptId);
  const episodesId = script.id;
  const existingRows = await u.db("o_storyboard").where({ projectId, scriptId: episodesId }).select("id");
  const existingCount = existingRows.length;

  if (existingCount > 0 && !force && !append) {
    const storyboardTable = buildStoryboardTable([]);
    await upsertProductionWorkData(projectId, episodesId, scriptContent, storyboardTable);
    return {
      projectId,
      episodesId,
      scriptName: toPublicWorkspaceName(script.name),
      scriptCreated,
      storyboardIds: existingRows.map((row: { id?: number | null }) => Number(row.id)).filter(Boolean),
      createdCount: 0,
      existingCount,
      replaced: false,
      appended: false,
      selectedNovelIds: novels.map((novel) => novel.id),
      selectedChapterIndexes: novels.map((novel) => novel.chapterIndex ?? novel.id),
      selectedChapterLabels: novels.map(formatChapterSelectionLabel),
      storyboardTable,
      message: `当前章节分镜工作区「${toPublicWorkspaceName(script.name)}」已有 ${existingCount} 个分镜，已切换到该章节。需要覆盖重做时请说“重新生成分镜”。`,
    };
  }

  const skill = await resolveStoryboardSkill(options.skillId, sourceText);
  if (!skill) stopStructuredStoryboardWrite("没有可用分镜 Skill");

  let parsed: SkillStoryboardJson | undefined;
  const requestText = [sourceText, options.userRequirement].filter(Boolean).join("\n");
  const modelContext = buildModelContext(project, novels, assets, scriptContent, requestText);
  const planning = modelContext.storyboardPlanning as StoryboardPlanningHint;
  try {
    let retryReason = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      parsed = normalizeStoryboardTimings(await invokeStoryboardModel(skill, modelContext, retryReason || undefined));
      const qualityReason = validateStoryboardQuality(parsed, planning);
      if (!qualityReason) break;
      retryReason = qualityReason;
      if (attempt === 2) throw new Error(`模型分镜质量不合格：${qualityReason}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "模型生成失败";
    if (message.startsWith("模型分镜质量不合格")) throw new Error(message);
    stopStructuredStoryboardWrite(message);
  }

  if (!parsed) stopStructuredStoryboardWrite("模型未生成可用分镜");

  if (planning.explicitShotCount && parsed.shots.length > planning.explicitShotCount) {
    parsed = { ...parsed, shots: parsed.shots.slice(0, planning.explicitShotCount), storyboardTable: "" };
  }

  const draftItems = toDraftItems(project, parsed, assets);
  if (!draftItems.length) stopStructuredStoryboardWrite("模型 JSON 没有可写入镜头");

  let removedCount = 0;
  if (existingCount > 0 && force) removedCount = await deleteStoryboards(episodesId, projectId);
  const startIndex = append && existingCount > 0 ? existingCount : 0;
  const storyboardIds = await insertDraftItems(projectId, episodesId, draftItems, startIndex);
  const storyboardTable = buildStoryboardTable(draftItems);
  await upsertProductionWorkData(projectId, episodesId, scriptContent, storyboardTable);

  const verb = removedCount > 0 ? `已覆盖旧分镜 ${removedCount} 个，并使用分镜方法重新生成` : append && existingCount > 0 ? "已使用分镜方法追加生成" : "已使用分镜方法生成";
  return {
    projectId,
    episodesId,
    scriptName: toPublicWorkspaceName(script.name),
    scriptCreated,
    storyboardIds,
    createdCount: storyboardIds.length,
    existingCount,
    replaced: removedCount > 0,
    appended: append && existingCount > 0,
    selectedNovelIds: novels.map((novel) => novel.id),
    selectedChapterIndexes: novels.map((novel) => novel.chapterIndex ?? novel.id),
    selectedChapterLabels: novels.map(formatChapterSelectionLabel),
    storyboardTable,
    usedSkillId: skill.id,
    usedSkillName: skill.name,
    message: `${verb} ${storyboardIds.length} 个分镜，章节分镜工作区为「${toPublicWorkspaceName(script.name)}」。已按单章节隔离处理，未把后续章节并入上下文。`,
  };
}
