import u from "@/utils";
import {
  AssetRow,
  GenerateProjectStoryboardDraftOptions,
  GenerateProjectStoryboardDraftResult,
  NovelRow,
  ProjectRow,
  StoryboardDraftItem,
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
  scene?: string;
  shotSize?: string;
  cameraMove?: string;
  action?: string;
  emotion?: string;
  lighting?: string;
  beat?: string;
}

interface SkillStoryboardJson {
  storyboardTable: string;
  shots: SkillShot[];
}

interface StoryboardPlanningHint {
  explicitShotCount?: number;
  estimatedMinimumShots: number;
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
    "4. 先生成 storyboardTable，字段为：镜号、叙事功能、时长、景别、运镜、场景、画面/动作、情绪、光影、台词/声音、关联资产。",
    "5. 再把分镜表逐行转换为 shots，shots.length 必须等于 storyboardTable 数据行数。",
    "",
    "每条 shot 必须能直接写入生产分镜：videoDesc 写完整视频描述，imagePrompt 写关键帧图像提示词，associateAssetNames 只能填写资产库中已存在的名称。",
  ].join("\n"),
};

const BASE_STORYBOARD_METHOD_PROMPT = DEFAULT_STORYBOARD_SKILL.content;

function fallback(projectId: number, options: GenerateProjectStoryboardWithSkillOptions, reason: string) {
  return generateProjectStoryboardDraft(projectId, options).then((result) => ({
    ...result,
    fallbackReason: result.fallbackReason ?? reason,
  }));
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
      duration: Number.isFinite(duration) && duration > 0 ? Math.min(Math.max(Math.round(duration), 1), 30) : 4,
      videoDesc,
      imagePrompt,
      associateAssetNames: Array.isArray(shot.associateAssetNames)
        ? shot.associateAssetNames.map((name: unknown) => cleanName(name)).filter(Boolean)
        : [],
      shouldGenerateImage: shot.shouldGenerateImage == null ? true : Boolean(shot.shouldGenerateImage),
      scene: nonEmpty(shot.scene),
      shotSize: nonEmpty(shot.shotSize),
      cameraMove: nonEmpty(shot.cameraMove),
      action: nonEmpty(shot.action),
      emotion: nonEmpty(shot.emotion),
      lighting: nonEmpty(shot.lighting),
      beat: nonEmpty(shot.beat),
    };
  });
  return {
    storyboardTable: nonEmpty(parsed.storyboardTable) ?? "",
    shots: normalizedShots.slice(0, 40),
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

function buildPlanningHint(novels: NovelRow[], sourceText?: string | null): StoryboardPlanningHint {
  const explicitShotCount = parseRequestedShotCount(sourceText);
  const eventCount = novels.reduce((sum, novel) => sum + countEventRows(novel.event), 0);
  const textLength = novels.reduce((sum, novel) => sum + String(novel.chapterData ?? "").length, 0);
  const estimatedMinimumShots = explicitShotCount ?? clamp(Math.max(4, eventCount * 2, Math.ceil(textLength / 700)), 4, 16);
  return {
    explicitShotCount,
    estimatedMinimumShots,
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

function buildModelContext(project: ProjectRow, novels: NovelRow[], assets: AssetRow[], scriptContent: string, userRequirement?: string) {
  const planning = buildPlanningHint(novels, userRequirement);
  const selectedChapters = novels.map((novel) => ({
    id: novel.id,
    chapterIndex: novel.chapterIndex,
    chapter: novel.chapter,
    event: novel.event,
    chapterData: compactText(novel.chapterData, 3200),
  }));
  return {
    project: {
      id: project.id,
      name: project.name,
      intro: project.intro,
      type: project.type,
      artStyle: project.artStyle,
      directorManual: project.directorManual,
      videoRatio: project.videoRatio,
    },
    visualManual: [project.artStyle, project.directorManual].filter(Boolean).join("\n\n"),
    selectedChapters,
    scriptContent: novels.length ? undefined : compactText(scriptContent, 4200),
    assets: assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      describe: compactText(asset.describe, 240),
      prompt: compactText(asset.prompt, 240),
    })),
    userRequirement,
    storyboardPlanning: planning,
  };
}

function toDraftItems(project: ProjectRow, parsed: SkillStoryboardJson, assets: AssetRow[]): StoryboardDraftItem[] {
  return parsed.shots.map((shot, index) => {
    const ids = mapAssetNamesToIds(assets, shot.associateAssetNames);
    const associatedAssets = ids.length ? assets.filter((asset) => ids.includes(asset.id)) : matchAssets(assets, `${shot.videoDesc}\n${shot.imagePrompt}`, 7);
    const assetNames = associatedAssets.map((asset) => cleanName(asset.name)).filter(Boolean);
    const prompt = shot.imagePrompt || buildStoryboardPrompt(project, shot.videoDesc, assetNames);
    return {
      index,
      duration: shot.duration,
      track: "主线分镜",
      videoDesc: shot.videoDesc,
      prompt,
      shouldGenerateImage: shot.shouldGenerateImage ? 1 : 0,
      associateAssetsIds: associatedAssets.map((asset) => asset.id),
      sourceTitle: shot.beat ?? shot.scene ?? `镜头 ${index + 1}`,
    };
  });
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

function shouldRetryForShotCount(parsed: SkillStoryboardJson, planning?: StoryboardPlanningHint) {
  const count = parsed.shots.length;
  if (planning?.explicitShotCount) return count !== planning.explicitShotCount;
  return (planning?.estimatedMinimumShots ?? 4) > 3 && count <= 3;
}

async function invokeStoryboardModel(skill: StoryboardGenerationSkill, context: Record<string, any>, retryReason?: string) {
  const planning = context.storyboardPlanning as StoryboardPlanningHint | undefined;
  const prompt = [
    BASE_STORYBOARD_METHOD_PROMPT,
    "",
    "选中的分镜方法 / 附加约束：",
    skill.content,
    "",
    "核心流程：",
    "1. 先阅读 selectedChapters 中的 event 和 chapterData，只处理这些章节。",
    "2. 先生成 storyboardTable，表中每一行代表一个真实分镜。",
    "3. 再按 storyboardTable 逐行生成 shots；shots.length 必须等于 storyboardTable 的数据行数。",
    "4. 每个 shot 必须有 videoDesc 和 imagePrompt，且两者不能只是复制同一句话。",
    storyboardCountInstruction(planning),
    retryReason ? `上一次输出不合格：${retryReason}。请重新拆分，不要沿用上一次数量。` : "",
    "",
    "输出要求：只返回 JSON，不要 Markdown，不要解释。",
    "JSON schema:",
    JSON.stringify(
      {
        storyboardTable: "markdown table string",
        shots: [
          {
            duration: 4,
            videoDesc: "画面、动作、调度",
            imagePrompt: "关键帧图像提示词",
            associateAssetNames: ["资产名称"],
            shouldGenerateImage: true,
            scene: "可选",
            shotSize: "可选",
            cameraMove: "可选",
            action: "可选",
            emotion: "可选",
            lighting: "可选",
            beat: "可选",
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
  const result = await u.Ai.Text("universalAi").invoke({ prompt });
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
      .where("projectId", projectId)
      .whereNull("assetsId")
      .select("id", "name", "type", "describe", "prompt", "imageId")
      .orderByRaw(`CASE type WHEN 'scene' THEN 1 WHEN 'role' THEN 2 WHEN 'tool' THEN 3 ELSE 4 END`)
      .orderBy("id", "asc") as Promise<AssetRow[]>,
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
  if (!skill) return fallback(projectId, { ...options, sourceText, force, append }, "没有可用分镜 Skill");

  let parsed: SkillStoryboardJson;
  const modelContext = buildModelContext(project, novels, assets, scriptContent, options.userRequirement ?? sourceText);
  const planning = modelContext.storyboardPlanning as StoryboardPlanningHint;
  try {
    parsed = await invokeStoryboardModel(skill, modelContext);
    if (shouldRetryForShotCount(parsed, planning)) {
      const expected = planning.explicitShotCount ? `用户要求 ${planning.explicitShotCount} 个，你返回了 ${parsed.shots.length} 个` : `未限定数量时不应只返回 ${parsed.shots.length} 个，建议不少于 ${planning.estimatedMinimumShots} 个`;
      parsed = await invokeStoryboardModel(skill, modelContext, expected);
    }
  } catch (error) {
    return fallback(projectId, { ...options, sourceText, force, append }, error instanceof Error ? error.message : "模型生成失败");
  }

  if (planning.explicitShotCount && parsed.shots.length > planning.explicitShotCount) {
    parsed = { ...parsed, shots: parsed.shots.slice(0, planning.explicitShotCount), storyboardTable: "" };
  }

  const draftItems = toDraftItems(project, parsed, assets);
  if (!draftItems.length) return fallback(projectId, { ...options, sourceText, force, append }, "模型 JSON 没有可写入镜头");

  let removedCount = 0;
  if (existingCount > 0 && force) removedCount = await deleteStoryboards(episodesId, projectId);
  const startIndex = append && existingCount > 0 ? existingCount : 0;
  const storyboardIds = await insertDraftItems(projectId, episodesId, draftItems, startIndex);
  const storyboardTable = parsed.storyboardTable || buildStoryboardTable(draftItems);
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
