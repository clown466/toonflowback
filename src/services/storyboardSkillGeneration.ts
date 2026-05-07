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
  estimatedMaximumShots: number;
  estimatedMinimumDuration: number;
  targetDurationMin: number;
  targetDurationMax: number;
  sourceDialogueSeconds: number;
  sourceDialogueText: string;
  sourceDialogueFastCutChunks: Array<{
    index: number;
    text: string;
    estimatedSeconds: number;
  }>;
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
    "3. 按事件复杂度和章节总时长预算决定镜头数量：未指定数量时不要默认 3 个；英文短剧应快切、短镜头、高爆发。",
    "4. 先生成 storyboardTable，字段固定为：镜号、时长、画面描述、角色1、角色描述1、角色图1、角色2、角色描述2、角色图2、参考、景别、角色动作、情绪、场景标签、光影氛围、音效、对白、分镜提示词、视频运动提示词。",
    "5. 再把分镜表逐行转换为 shots，shots.length 必须等于 storyboardTable 数据行数。",
    "",
    "每条 shot 必须能直接写入生产分镜：videoDesc 写完整视频描述，imagePrompt 写关键帧图像提示词，associateAssetNames 只能填写资产库中已存在的名称。",
  ].join("\n"),
};

const BASE_STORYBOARD_METHOD_PROMPT = DEFAULT_STORYBOARD_SKILL.content;
const MAX_STORYBOARD_SHOTS = 60;
const MIN_STORYBOARD_SHOT_DURATION = 1;
const DEFAULT_STORYBOARD_SHOT_DURATION = 3;
const PREFERRED_STORYBOARD_SHOT_MAX = 6;
const MAX_STORYBOARD_SHOT_DURATION = 15;
const FAST_DRAMA_MIN_AVERAGE_SHOT_DURATION = 2;
const FAST_DRAMA_PREFERRED_NON_DIALOGUE_SHOT_MAX = 6;
const FAST_DRAMA_PREFERRED_DIALOGUE_SHOT_MAX = 6;
const MAX_DIALOGUE_SECONDS_PER_STORYBOARD_SHOT = 6;
const MAX_DIALOGUE_WORDS_PER_STORYBOARD_SHOT_HINT = 12;
const MAX_CJK_CHARS_PER_STORYBOARD_SHOT_HINT = 16;
const STANDARD_CHAPTER_TARGET_MIN_SECONDS = 90;
const STANDARD_CHAPTER_TARGET_MAX_SECONDS = 120;
const CHAPTER_DURATION_HARD_CAP_SECONDS = 120;
const MIN_CHAPTER_TARGET_SECONDS = 24;
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
      duration: Number.isFinite(duration) && duration > 0 ? Math.min(Math.max(Math.round(duration), MIN_STORYBOARD_SHOT_DURATION), MAX_STORYBOARD_SHOT_DURATION) : DEFAULT_STORYBOARD_SHOT_DURATION,
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

function hasMostlyEnglishText(text: string) {
  const englishWords = text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)?/g)?.length ?? 0;
  const cjkChars = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  return englishWords >= Math.max(3, cjkChars);
}

function splitOversizedSentence(text: string, emotion?: string | null) {
  const source = text.trim();
  if (!source) return [];
  const pieces = /\s/.test(source)
    ? source.split(/\s+/).filter(Boolean)
    : source.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)?|[\u3400-\u9fff]|[^\sA-Za-z0-9\u3400-\u9fff]/g) ?? [source];
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    const separator = /\s/.test(source) && current ? " " : "";
    const candidate = `${current}${separator}${piece}`.trim();
    if (current && estimateSpeechDurationSeconds(candidate, emotion) > MAX_DIALOGUE_SECONDS_PER_STORYBOARD_SHOT) {
      chunks.push(current);
      current = piece;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitDialogueContentIntoFastCuts(text: string, emotion?: string | null) {
  const sentences = text.match(/[^.!?;:，。！？；：…]+[.!?;:，。！？；：…]*/g)?.map((part) => part.trim()).filter(Boolean) ?? [text.trim()].filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const candidate = [current, sentence].filter(Boolean).join(" ").trim();
    if (candidate && estimateSpeechDurationSeconds(candidate, emotion) <= MAX_DIALOGUE_SECONDS_PER_STORYBOARD_SHOT) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    if (estimateSpeechDurationSeconds(sentence, emotion) <= MAX_DIALOGUE_SECONDS_PER_STORYBOARD_SHOT) {
      current = sentence;
    } else {
      chunks.push(...splitOversizedSentence(sentence, emotion));
      current = "";
    }
  }
  if (current) chunks.push(current);
  return chunks.filter(Boolean);
}

function splitDialogueIntoFastCutChunks(dialogue: string, emotion?: string | null) {
  const source = nonEmpty(dialogue);
  if (!source || isNoDialogueText(source)) return [];
  const chunks: string[] = [];
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || isNoDialogueText(line)) continue;
    const speakerMatch = line.match(/^(\s*[-*]?\s*[\w\u4e00-\u9fa5 .'"’‘-]{1,36}\s*[:：]\s*)([\s\S]+)$/);
    const speaker = speakerMatch?.[1] ?? "";
    const content = (speakerMatch?.[2] ?? line).trim();
    for (const chunk of splitDialogueContentIntoFastCuts(content, emotion)) {
      chunks.push(`${speaker}${chunk}`.trim());
    }
  }
  return chunks.length ? chunks : [source];
}

function fastCutVariant(index: number, english: boolean) {
  const englishVariants = ["tight close-up", "reaction shot", "over-shoulder angle", "insert detail", "slow push-in", "side tracking angle"];
  const chineseVariants = ["特写切角度", "反应镜头", "过肩镜头", "道具插入", "推近特写", "横移跟拍"];
  const variants = english ? englishVariants : chineseVariants;
  return variants[index % variants.length];
}

function appendFastCutCue(text: string | undefined, cue: string, part: number, total: number, english: boolean) {
  const base = nonEmpty(text) ?? "";
  const suffix = english ? `fast dialogue cut ${part}/${total}, ${cue}` : `对白快切 ${part}/${total}，${cue}`;
  return base ? `${base}; ${suffix}` : suffix;
}

function splitOversizedDialogueShots(parsed: SkillStoryboardJson, planning?: StoryboardPlanningHint): SkillStoryboardJson {
  if (planning?.explicitShotCount) return parsed;
  const shots: SkillShot[] = [];
  let changed = false;
  for (const shot of parsed.shots) {
    const dialogue = extractShotDialogueText(shot);
    if (!dialogue || estimateSpeechDurationSeconds(dialogue, shot.emotion) <= MAX_DIALOGUE_SECONDS_PER_STORYBOARD_SHOT) {
      shots.push(shot);
      continue;
    }

    const chunks = splitDialogueIntoFastCutChunks(dialogue, shot.emotion);
    if (chunks.length <= 1) {
      shots.push(shot);
      continue;
    }

    changed = true;
    const english = hasMostlyEnglishText(`${dialogue}\n${shot.videoDesc}\n${shot.imagePrompt}`);
    chunks.forEach((chunk, chunkIndex) => {
      const cue = fastCutVariant(chunkIndex, english);
      shots.push({
        ...shot,
        duration: clamp(estimateSpeechDurationSeconds(chunk, shot.emotion), 2, PREFERRED_STORYBOARD_SHOT_MAX),
        dialogue: chunk,
        videoDesc: appendFastCutCue(shot.videoDesc, cue, chunkIndex + 1, chunks.length, english),
        imagePrompt: appendFastCutCue(shot.imagePrompt, cue, chunkIndex + 1, chunks.length, english),
        cameraMove: shot.cameraMove ?? cue,
        beat: appendFastCutCue(shot.beat, cue, chunkIndex + 1, chunks.length, english),
        videoMotionPrompt: appendFastCutCue(shot.videoMotionPrompt ?? shot.videoDesc, cue, chunkIndex + 1, chunks.length, english),
      });
    });
  }
  return changed ? { ...parsed, storyboardTable: "", shots: shots.slice(0, MAX_STORYBOARD_SHOTS) } : parsed;
}

function getSourceDialogue(novels: NovelRow[]) {
  const text = novels
    .map((novel) => [novel.event, novel.chapterData].filter(Boolean).join("\n"))
    .filter(Boolean)
    .join("\n\n");
  return extractDialogueFromSource(text);
}

function estimateChapterDurationBudget(input: {
  explicitShotCount?: number;
  sourceDialogueSeconds: number;
  eventCount: number;
  textLength: number;
}) {
  if (input.explicitShotCount) {
    const targetMin = input.explicitShotCount * MIN_STORYBOARD_SHOT_DURATION;
    const targetMax = Math.min(input.explicitShotCount * FAST_DRAMA_PREFERRED_DIALOGUE_SHOT_MAX, input.explicitShotCount * MAX_STORYBOARD_SHOT_DURATION);
    const cappedTargetMax = Math.min(Math.max(targetMin, targetMax), CHAPTER_DURATION_HARD_CAP_SECONDS);
    return { targetDurationMin: Math.min(targetMin, cappedTargetMax), targetDurationMax: cappedTargetMax };
  }

  const narrativeSeconds = Math.ceil(input.textLength / 45);
  const eventSeconds = input.eventCount > 0 ? input.eventCount * 12 : 0;
  const rawTargetMax = Math.max(input.sourceDialogueSeconds * 1.1, narrativeSeconds, eventSeconds);
  const targetDurationMax = clamp(Math.ceil(rawTargetMax || MIN_CHAPTER_TARGET_SECONDS), MIN_CHAPTER_TARGET_SECONDS, STANDARD_CHAPTER_TARGET_MAX_SECONDS);
  const standardChapterFloor = input.textLength >= 2500 || input.sourceDialogueSeconds >= 45 ? STANDARD_CHAPTER_TARGET_MIN_SECONDS : Math.floor(targetDurationMax * 0.7);
  const targetDurationMin = Math.min(
    targetDurationMax,
    Math.max(MIN_CHAPTER_TARGET_SECONDS, standardChapterFloor, input.sourceDialogueSeconds ? Math.ceil(input.sourceDialogueSeconds * 0.9) : 0),
  );
  return { targetDurationMin, targetDurationMax };
}

function buildPlanningHint(novels: NovelRow[], sourceText?: string | null): StoryboardPlanningHint {
  const explicitShotCount = parseRequestedShotCount(sourceText);
  const eventCount = novels.reduce((sum, novel) => sum + countEventRows(novel.event), 0);
  const textLength = novels.reduce((sum, novel) => sum + String(novel.chapterData ?? "").length, 0);
  const sourceDialogueText = getSourceDialogue(novels);
  const sourceDialogueSeconds = estimateSpeechDurationSeconds(sourceDialogueText);
  const sourceDialogueFastCutChunks = splitDialogueIntoFastCutChunks(sourceDialogueText)
    .slice(0, MAX_STORYBOARD_SHOTS)
    .map((text, index) => ({
      index: index + 1,
      text: compactText(text, 180),
      estimatedSeconds: estimateSpeechDurationSeconds(text),
    }));
  const dialogueShotFloor = sourceDialogueSeconds > 0 ? Math.ceil(sourceDialogueSeconds / MAX_DIALOGUE_SECONDS_PER_STORYBOARD_SHOT) : 0;
  const estimatedMinimumShots = explicitShotCount ?? clamp(Math.max(4, eventCount * 2, Math.ceil(textLength / 700), dialogueShotFloor), 4, 24);
  const rawDurationBudget = estimateChapterDurationBudget({ explicitShotCount, sourceDialogueSeconds, eventCount, textLength });
  const dialogueVisualBreathingRoom = sourceDialogueSeconds > 0 ? sourceDialogueSeconds + estimatedMinimumShots * 3 : 0;
  const targetDurationMax = Math.min(
    CHAPTER_DURATION_HARD_CAP_SECONDS,
    explicitShotCount ? explicitShotCount * MAX_STORYBOARD_SHOT_DURATION : STANDARD_CHAPTER_TARGET_MAX_SECONDS,
    Math.max(rawDurationBudget.targetDurationMax, estimatedMinimumShots * DEFAULT_STORYBOARD_SHOT_DURATION, dialogueVisualBreathingRoom),
  );
  const targetDurationMin = Math.min(targetDurationMax, rawDurationBudget.targetDurationMin);
  const estimatedMaximumShots = explicitShotCount ?? clamp(Math.ceil(targetDurationMax / FAST_DRAMA_MIN_AVERAGE_SHOT_DURATION), estimatedMinimumShots, MAX_STORYBOARD_SHOTS);
  const estimatedMinimumDuration = sourceDialogueSeconds > 0 ? Math.min(targetDurationMax, Math.ceil(sourceDialogueSeconds * 0.9)) : 0;
  return {
    explicitShotCount,
    estimatedMinimumShots,
    estimatedMaximumShots,
    estimatedMinimumDuration,
    targetDurationMin,
    targetDurationMax,
    sourceDialogueSeconds,
    sourceDialogueText: compactText(sourceDialogueText, 1000),
    sourceDialogueFastCutChunks,
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
    dialogueTimingRules: {
      preferredShotSeconds: "2-6",
      maxDialogueSecondsPerShot: MAX_DIALOGUE_SECONDS_PER_STORYBOARD_SHOT,
      maxEnglishWordsPerDialogueShotHint: MAX_DIALOGUE_WORDS_PER_STORYBOARD_SHOT_HINT,
      maxCjkCharsPerDialogueShotHint: MAX_CJK_CHARS_PER_STORYBOARD_SHOT_HINT,
      sourceDialogueFastCutChunks: planning.sourceDialogueFastCutChunks,
      note: "生成 shots[].dialogue 时优先使用这些预切片段。不要把 selectedChapters.chapterData 里的完整长句复制进单个镜头；不要把大部分镜头机械写成 2 秒。",
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

function getShotDurationFloor(shot: SkillShot) {
  return MIN_STORYBOARD_SHOT_DURATION;
}

function getPreferredShotDurationCap(shot: SkillShot, floor: number) {
  const hasDialogue = Boolean(extractShotDialogueText(shot));
  const preferred = hasDialogue ? FAST_DRAMA_PREFERRED_DIALOGUE_SHOT_MAX : FAST_DRAMA_PREFERRED_NON_DIALOGUE_SHOT_MAX;
  return Math.min(Math.max(preferred, floor), MAX_STORYBOARD_SHOT_DURATION);
}

function compressStoryboardToTarget(shots: SkillShot[], targetDurationMax?: number) {
  if (!targetDurationMax) return shots;
  const normalized = shots.map((shot) => ({ ...shot }));
  let total = normalized.reduce((sum, shot) => sum + shot.duration, 0);

  while (total > targetDurationMax) {
    let targetIndex = -1;
    let reducibleSeconds = 0;
    for (const [index, shot] of normalized.entries()) {
      const floor = getShotDurationFloor(shot);
      const reducible = shot.duration - floor;
      if (reducible > reducibleSeconds) {
        reducibleSeconds = reducible;
        targetIndex = index;
      }
    }
    if (targetIndex < 0 || reducibleSeconds <= 0) break;
    normalized[targetIndex] = { ...normalized[targetIndex], duration: normalized[targetIndex].duration - 1 };
    total -= 1;
  }

  return normalized;
}

function normalizeStoryboardTimings(parsed: SkillStoryboardJson, planning?: StoryboardPlanningHint): SkillStoryboardJson {
  const shots = parsed.shots.map((shot) => {
    const floor = getShotDurationFloor(shot);
    const preferredCap = getPreferredShotDurationCap(shot, floor);
    const duration = Math.min(Math.max(Math.round(shot.duration), floor), preferredCap);
    return { ...shot, duration };
  });

  return {
    ...parsed,
    shots: compressStoryboardToTarget(shots, planning?.targetDurationMax),
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
    if (dialogueDuration > MAX_DIALOGUE_SECONDS_PER_STORYBOARD_SHOT) {
      return { index: index + 1, dialogueDuration };
    }
  }
  return null;
}

function hasFlatTwoSecondTiming(parsed: SkillStoryboardJson, planning?: StoryboardPlanningHint) {
  if (planning?.explicitShotCount || parsed.shots.length < 6) return false;
  const canUseThreeSecondAverage = !planning?.targetDurationMax || parsed.shots.length * DEFAULT_STORYBOARD_SHOT_DURATION <= planning.targetDurationMax;
  if (!canUseThreeSecondAverage) return false;
  const shortCount = parsed.shots.filter((shot) => shot.duration <= 2).length;
  const hasMediumHold = parsed.shots.some((shot) => shot.duration >= 4);
  return shortCount / parsed.shots.length >= 0.8 && !hasMediumHold;
}

function storyboardCountInstruction(planning?: StoryboardPlanningHint) {
  if (planning?.explicitShotCount) {
    return `用户明确要求数量：必须输出 ${planning.explicitShotCount} 个分镜；storyboardTable 数据行数和 shots.length 都必须等于 ${planning.explicitShotCount}。`;
  }
  return [
    `用户未明确限定数量：不要默认生成 3 个分镜，也不要为了省事只生成 3 个。`,
    `请先按章节事件拆分完整分镜表，再由分镜表逐行生成 shots。当前建议 ${planning?.estimatedMinimumShots ?? 4}-${planning?.estimatedMaximumShots ?? 24} 个分镜。`,
    `英文短剧节奏必须快，但不能机械地全写成 2 秒：大多数镜头控制在 2-6 秒；动作/插入快切可 1-2 秒；常规对白/反应镜头多用 3-5 秒；关键情绪停顿可 5-6 秒。`,
    `一句台词不一定非要一个镜头拍完；长台词必须拆成多个 2-6 秒镜头，用不同景别、反应镜头、切入道具、越肩镜头、插入镜头承接同一句话。`,
    `除非用户明确要求极限快切，不要让 80% 以上镜头都是 2 秒；分镜时长要有 2/3/4/5/6 秒的节奏变化。`,
    `如果只返回 3 个分镜，会被视为拆镜不足。`,
  ].join("\n");
}

function validateStoryboardQuality(parsed: SkillStoryboardJson, planning?: StoryboardPlanningHint) {
  const count = parsed.shots.length;
  if (planning?.explicitShotCount && count !== planning.explicitShotCount) return `用户要求 ${planning.explicitShotCount} 个分镜，你返回了 ${count} 个`;

  if (!planning?.explicitShotCount && count < (planning?.estimatedMinimumShots ?? 4)) {
    return `分镜拆分不足：当前 ${count} 个，按事件和对白长度建议不少于 ${planning?.estimatedMinimumShots ?? 4} 个`;
  }

  if (!planning?.explicitShotCount && planning?.estimatedMaximumShots && count > planning.estimatedMaximumShots) {
    return `分镜拆分过多：当前 ${count} 个，按章节时长预算建议不超过 ${planning.estimatedMaximumShots} 个`;
  }

  if (hasFlatTwoSecondTiming(parsed, planning)) {
    return `分镜时长过于机械：当前大部分镜头都是 2s。请按 2-6s 重新分配节奏，常规对白/反应镜头用 3-5s，关键停顿可用 5-6s`;
  }

  const oversized = findOversizedDialogueShot(parsed);
  if (oversized) {
    return `第 ${oversized.index} 镜对白预计需要 ${oversized.dialogueDuration}s，超过快切分镜单镜头对白建议 ${MAX_DIALOGUE_SECONDS_PER_STORYBOARD_SHOT}s；请把同一句台词拆成多个 2-6s 镜头和反应/切角度镜头`;
  }

  if (planning?.estimatedMinimumDuration && getTotalDuration(parsed) < planning.estimatedMinimumDuration) {
    return `总时长过短：当前 ${getTotalDuration(parsed)}s，选中章节对白至少需要约 ${planning.estimatedMinimumDuration}s`;
  }

  if (planning?.targetDurationMax && getTotalDuration(parsed) > planning.targetDurationMax) {
    return `总时长过长：当前 ${getTotalDuration(parsed)}s，当前章节硬上限 ${planning.targetDurationMax}s；请压缩节奏、减少冗余镜头或浓缩对白`;
  }

  const minimumDialogueCoverage = planning?.sourceDialogueSeconds ? Math.min(planning.sourceDialogueSeconds * 0.6, (planning.targetDurationMax || CHAPTER_DURATION_HARD_CAP_SECONDS) * 0.75) : 0;
  if (planning?.sourceDialogueSeconds && planning.sourceDialogueSeconds >= 8 && getOutputDialogueSeconds(parsed) < minimumDialogueCoverage) {
    return `输出对白覆盖不足：选中章节对白约 ${planning.sourceDialogueSeconds}s，但分镜对白字段明显缺失；请在 120 秒内保留关键对白并浓缩次要台词`;
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
    `7. 单条分镜 duration 应以 2-6s 为主，动作插入快切允许 ${MIN_STORYBOARD_SHOT_DURATION}-2s；系统会把普通单镜头压到 ${PREFERRED_STORYBOARD_SHOT_MAX}s 以内。`,
    "8. 4-15s 是单张章节导演板/一次 AI 视频生成片段的总时长范围，不是单条分镜的最小时长。后续系统会把连续分镜按不超过 15s 分组到导演板。",
    `9. shots[].dialogue 是本镜听到的短对白片段，不是整句原文。每镜对白预计不得超过 ${MAX_DIALOGUE_SECONDS_PER_STORYBOARD_SHOT}s；英文通常不超过 ${MAX_DIALOGUE_WORDS_PER_STORYBOARD_SHOT_HINT} 个词，中文通常不超过 ${MAX_CJK_CHARS_PER_STORYBOARD_SHOT_HINT} 个汉字。`,
    "10. 一句台词不必一个镜头拍完。长台词必须拆成多个 2-6s 镜头，用正反打、反应、道具插入、越肩、推近、横移等多角度完成。",
    "11. 上下文 dialogueTimingRules.sourceDialogueFastCutChunks 是系统预切好的对白片段计划；生成 shots 时优先按这些片段分配，不要从 selectedChapters.chapterData 复制完整长句到单个 shot.dialogue。",
    "12. 不要把所有镜头都写成 2s。合理分布：爆点/插入 1-2s，普通动作 3-4s，对白反应 3-5s，重要停顿 5-6s。",
    planning ? `13. 当前章节目标总时长：${planning.targetDurationMin}-${planning.targetDurationMax}s；硬上限 ${CHAPTER_DURATION_HARD_CAP_SECONDS}s，绝对不能超过 2 分钟。分镜总时长必须在这个预算内完成。` : "",
    planning?.sourceDialogueSeconds ? `14. 当前选中章节原文对白预计约 ${planning.sourceDialogueSeconds}s；如果对白过多，请在 120 秒内保留关键对白并浓缩次要台词，不要为了保留全部台词突破总时长。` : "",
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
            dialogue: "本镜短对白片段，优先取 dialogueTimingRules.sourceDialogueFastCutChunks 中的一个片段；无台词则写无台词",
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
  const { textStream } = await u.Ai.Text(STORYBOARD_MODEL_KEY).stream({ prompt });
  let text = "";
  for await (const chunk of textStream) {
    text += chunk;
  }
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
      parsed = normalizeStoryboardTimings(await invokeStoryboardModel(skill, modelContext, retryReason || undefined), planning);
      const qualityReason = validateStoryboardQuality(parsed, planning);
      if (!qualityReason) break;
      if (attempt === 2) {
        const repaired = normalizeStoryboardTimings(splitOversizedDialogueShots(parsed, planning), planning);
        const repairReason = validateStoryboardQuality(repaired, planning);
        if (!repairReason) {
          parsed = repaired;
          break;
        }
      }
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
