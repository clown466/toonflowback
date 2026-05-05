import u from "@/utils";
import {
  AssetRow,
  FLOVA_SCRIPT_NAME,
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

export interface GenerateProjectStoryboardWithSkillOptions extends GenerateProjectStoryboardDraftOptions {
  skillId?: string;
  userRequirement?: string;
}

const DEFAULT_STORYBOARD_SKILL: StoryboardGenerationSkill = {
  id: "default_storyboard_text_generation",
  name: "默认结构化分镜生成",
  description: "基于选中章节和项目资产生成结构化分镜 JSON",
  content: [
    "你是动画短剧分镜导演。请只基于给定的选中章节、项目设定、视觉手册/导演手册和资产库生成分镜。",
    "不要引入未提供的后续章节正文或未来情节。",
    "每个镜头必须能直接写入生产分镜，videoDesc 写画面动作，imagePrompt 写关键帧图像提示词。",
    "associateAssetNames 只能填写资产库中已存在的名称。",
  ].join("\n"),
};

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
      return await service.resolveStoryboardGenerationSkill({ skillId, requestText });
    }
    if (typeof service.listStoryboardGenerationSkills === "function") {
      const skills = await service.listStoryboardGenerationSkills();
      const selected = skillId ? skills.find((skill: any) => skill.id === skillId) : skills[0];
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

async function invokeStoryboardModel(skill: StoryboardGenerationSkill, context: Record<string, any>) {
  const prompt = [
    skill.content,
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
      scriptName: script.name ?? FLOVA_SCRIPT_NAME,
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
      message: `当前生产容器「${script.name ?? FLOVA_SCRIPT_NAME}」已有 ${existingCount} 个分镜，已切换到该章节剧集。需要覆盖重做时请说“重新生成分镜”。`,
    };
  }

  const skill = await resolveStoryboardSkill(options.skillId, sourceText);
  if (!skill) return fallback(projectId, { ...options, sourceText, force, append }, "没有可用分镜 Skill");

  let parsed: SkillStoryboardJson;
  try {
    parsed = await invokeStoryboardModel(skill, buildModelContext(project, novels, assets, scriptContent, options.userRequirement ?? sourceText));
  } catch (error) {
    return fallback(projectId, { ...options, sourceText, force, append }, error instanceof Error ? error.message : "模型生成失败");
  }

  const draftItems = toDraftItems(project, parsed, assets);
  if (!draftItems.length) return fallback(projectId, { ...options, sourceText, force, append }, "模型 JSON 没有可写入镜头");

  let removedCount = 0;
  if (existingCount > 0 && force) removedCount = await deleteStoryboards(episodesId, projectId);
  const startIndex = append && existingCount > 0 ? existingCount : 0;
  const storyboardIds = await insertDraftItems(projectId, episodesId, draftItems, startIndex);
  const storyboardTable = parsed.storyboardTable || buildStoryboardTable(draftItems);
  await upsertProductionWorkData(projectId, episodesId, scriptContent, storyboardTable);

  const verb = removedCount > 0 ? `已覆盖旧分镜 ${removedCount} 个，并使用分镜 Skill 重新生成` : append && existingCount > 0 ? "已使用分镜 Skill 追加生成" : "已使用分镜 Skill 生成";
  return {
    projectId,
    episodesId,
    scriptName: script.name ?? FLOVA_SCRIPT_NAME,
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
    message: `${verb} ${storyboardIds.length} 个分镜，生产剧集为「${script.name ?? FLOVA_SCRIPT_NAME}」。已按单章节隔离处理，未把后续章节并入上下文。`,
  };
}
