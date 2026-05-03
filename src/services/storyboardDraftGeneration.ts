import u from "@/utils";

interface ProjectRow {
  id: number;
  name?: string | null;
  intro?: string | null;
  type?: string | null;
  artStyle?: string | null;
  directorManual?: string | null;
  videoRatio?: string | null;
}

interface NovelRow {
  id: number;
  chapterIndex?: number | null;
  chapter?: string | null;
  chapterData?: string | null;
  event?: string | null;
  eventState?: number | null;
}

interface ScriptRow {
  id: number;
  name?: string | null;
  content?: string | null;
  projectId?: number | null;
  createTime?: number | null;
}

interface AssetRow {
  id: number;
  name?: string | null;
  type?: string | null;
  describe?: string | null;
  prompt?: string | null;
  imageId?: number | null;
}

interface StoryboardDraftItem {
  index: number;
  duration: number;
  track: string;
  videoDesc: string;
  prompt: string;
  shouldGenerateImage: number;
  associateAssetsIds: number[];
  sourceTitle: string;
}

export interface GenerateProjectStoryboardDraftOptions {
  sourceText?: string;
  preferredScriptId?: number;
  force?: boolean;
  append?: boolean;
}

export interface GenerateProjectStoryboardDraftResult {
  projectId: number;
  episodesId: number;
  scriptName: string;
  scriptCreated: boolean;
  storyboardIds: number[];
  createdCount: number;
  existingCount: number;
  replaced: boolean;
  appended: boolean;
  storyboardTable: string;
  message: string;
}

export const FLOVA_SCRIPT_NAME = "Flova 原文生产容器";
const MAIN_TRACK_NAME = "主线分镜";

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function compactText(value: unknown, maxLength = 600) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}...`;
}

function cleanName(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeForMatch(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitAssetAliases(asset: AssetRow) {
  const name = cleanName(asset.name);
  if (!name) return [];
  const parts = name
    .split(/[/,，、|()（）]+/)
    .map((part) => normalizeForMatch(part))
    .filter(Boolean);
  const normalizedName = normalizeForMatch(name);
  return Array.from(new Set([normalizedName, ...parts].filter((alias) => alias.length >= 2)));
}

function parseEvent(event: string | null | undefined) {
  const text = nonEmpty(event);
  if (!text) return { title: "", assetHint: "", summary: "" };
  const cells = text
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
  if (cells.length >= 3) {
    return {
      title: cells[0],
      assetHint: cells[1],
      summary: cells[2],
    };
  }
  return { title: "", assetHint: "", summary: text };
}

function buildScriptContent(project: ProjectRow, novels: NovelRow[], fallbackScripts: ScriptRow[]) {
  if (novels.length) {
    return novels
      .map((novel) => {
        const parsed = parseEvent(novel.event);
        const title = `项目内第${novel.chapterIndex ?? novel.id}条 ${novel.chapter ?? ""}`.trim();
        const event = parsed.summary ? `事件摘要：${parsed.summary}` : "";
        const original = nonEmpty(novel.chapterData) ? `原文：${compactText(novel.chapterData, 1800)}` : "";
        return [title, event, original].filter(Boolean).join("\n");
      })
      .join("\n\n");
  }

  const scriptContent = fallbackScripts.map((script) => `${script.name ?? "未命名剧本"}\n${script.content ?? ""}`).join("\n\n").trim();
  if (scriptContent) return scriptContent;
  return [project.name, project.type, project.intro].filter(Boolean).join("\n") || "Flova 自动创建的生产容器";
}

async function linkProjectAssetsToScript(projectId: number, scriptId: number) {
  const assets = await u.db("o_assets").where("projectId", projectId).whereNull("assetsId").select("id");
  const existing = await u.db("o_scriptAssets").where("scriptId", scriptId).select("assetId");
  const existingIds = new Set(existing.map((row: { assetId?: number | null }) => row.assetId).filter((id): id is number => typeof id === "number"));
  const rows = assets
    .map((asset: { id?: number | null }) => asset.id)
    .filter((id): id is number => typeof id === "number" && !existingIds.has(id))
    .map((assetId) => ({ scriptId, assetId }));
  if (rows.length) await u.db("o_scriptAssets").insert(rows);
  return assets.length;
}

async function ensureProductionScript(project: ProjectRow, novels: NovelRow[], preferredScriptId?: number) {
  const scriptRows = await u.db("o_script").where("projectId", project.id).select("id", "name", "content", "projectId", "createTime").orderBy("id", "asc");
  const scripts: ScriptRow[] = scriptRows.filter((script: { id?: number | null }): script is ScriptRow => typeof script.id === "number");
  const content = buildScriptContent(project, novels, scripts);

  if (preferredScriptId) {
    const preferred = scripts.find((script) => script.id === preferredScriptId);
    if (preferred) {
      await linkProjectAssetsToScript(project.id, preferred.id);
      return { script: preferred, created: false, content };
    }
  }

  const flovaScript = scripts.find((script) => script.name === FLOVA_SCRIPT_NAME);
  if (flovaScript) {
    const update: Partial<ScriptRow> = {};
    if (content && content !== flovaScript.content) update.content = content;
    if (Object.keys(update).length > 0) await u.db("o_script").where("id", flovaScript.id).update(update);
    await linkProjectAssetsToScript(project.id, flovaScript.id);
    return { script: { ...flovaScript, ...update }, created: false, content };
  }

  if (!novels.length && scripts.length) {
    const script = scripts[scripts.length - 1]!;
    await linkProjectAssetsToScript(project.id, script.id);
    return { script, created: false, content: script.content || content };
  }

  const [insertedId] = await u.db("o_script").insert({
    name: FLOVA_SCRIPT_NAME,
    content,
    projectId: project.id,
    createTime: Date.now(),
  });
  const script: ScriptRow = {
    id: Number(insertedId),
    name: FLOVA_SCRIPT_NAME,
    content,
    projectId: project.id,
    createTime: Date.now(),
  };
  await linkProjectAssetsToScript(project.id, script.id);
  return { script, created: true, content };
}

function buildSourceUnits(project: ProjectRow, novels: NovelRow[], scriptContent: string) {
  if (novels.length) {
    return novels.map((novel) => {
      const parsed = parseEvent(novel.event);
      const title = parsed.title || `项目内第${novel.chapterIndex ?? novel.id}条 ${novel.chapter ?? ""}`.trim();
      const sourceText = [parsed.assetHint, parsed.summary, novel.chapterData].filter(Boolean).join("\n");
      const summary = compactText(parsed.summary || novel.chapterData || project.intro || title, 420);
      return {
        title,
        assetHint: parsed.assetHint,
        summary,
        sourceText,
      };
    });
  }

  const chunks = scriptContent
    .split(/\n{2,}|(?<=。)|(?<=！)|(?<=？)|(?<=\.)\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 12)
    .slice(0, 10);

  return (chunks.length ? chunks : [project.intro || scriptContent || project.name || "项目内容"]).map((chunk, index) => ({
    title: `段落 ${index + 1}`,
    assetHint: "",
    summary: compactText(chunk, 420),
    sourceText: chunk,
  }));
}

function matchAssets(assets: AssetRow[], sourceText: string, maxCount = 7) {
  const normalizedSource = normalizeForMatch(sourceText);
  const matched = assets.filter((asset) => splitAssetAliases(asset).some((alias) => normalizedSource.includes(alias)));
  const byType = (type: string) => matched.filter((asset) => asset.type === type);
  const result: AssetRow[] = [];
  const pushUnique = (items: AssetRow[]) => {
    for (const item of items) {
      if (result.some((existing) => existing.id === item.id)) continue;
      result.push(item);
      if (result.length >= maxCount) return;
    }
  };

  pushUnique(byType("scene").slice(0, 2));
  pushUnique(byType("role").slice(0, 4));
  pushUnique(byType("tool").slice(0, 2));
  pushUnique(matched.slice(0, maxCount));

  if (result.length === 0) {
    pushUnique(assets.filter((asset) => asset.type === "scene").slice(0, 1));
    pushUnique(assets.filter((asset) => asset.type === "role").slice(0, 3));
    pushUnique(assets.filter((asset) => asset.type === "tool").slice(0, 1));
  }

  return result.slice(0, maxCount);
}

function buildStoryboardPrompt(project: ProjectRow, videoDesc: string, assetNames: string[]) {
  const style = [project.artStyle, project.directorManual, project.type].filter(Boolean).join(", ") || "cinematic animation";
  const ratio = project.videoRatio || "16:9";
  return [
    `Storyboard keyframe, ${style}, aspect ratio ${ratio}.`,
    videoDesc,
    assetNames.length ? `Use consistent project assets: ${assetNames.join(", ")}.` : "",
    "Clear composition, expressive character acting, cinematic lighting, no subtitles, no UI, no watermark.",
  ]
    .filter(Boolean)
    .join(" ");
}

function createDraftItems(project: ProjectRow, novels: NovelRow[], scriptContent: string, assets: AssetRow[]) {
  const units = buildSourceUnits(project, novels, scriptContent).slice(0, 12);
  const shotsPerUnit = units.length >= 8 ? 2 : 3;
  const cameras = ["宽幅建立镜头，交代地点和冲突", "中近景动作镜头，突出角色反应和推进", "特写/运动镜头，制造笑点、危险或转场"];
  const draft: StoryboardDraftItem[] = [];

  for (const [unitIndex, unit] of units.entries()) {
    const associatedAssets = matchAssets(assets, `${unit.title}\n${unit.assetHint}\n${unit.summary}\n${unit.sourceText}`);
    const assetNames = associatedAssets.map((asset) => cleanName(asset.name)).filter(Boolean);
    const sourceTitle = unit.title || `段落 ${unitIndex + 1}`;

    for (let shotIndex = 0; shotIndex < shotsPerUnit; shotIndex++) {
      const index = draft.length;
      const camera = cameras[shotIndex] ?? cameras[cameras.length - 1]!;
      const beat =
        shotIndex === 0
          ? `镜头${index + 1}：${sourceTitle}的开场，${unit.summary}`
          : shotIndex === 1
            ? `镜头${index + 1}：${sourceTitle}的核心动作推进，${unit.summary}`
            : `镜头${index + 1}：${sourceTitle}的结果反应和下一段转场，${unit.summary}`;
      const videoDesc = `${beat}。镜头设计：${camera}。`;

      draft.push({
        index,
        duration: shotIndex === 1 ? 5 : 4,
        track: MAIN_TRACK_NAME,
        videoDesc,
        prompt: buildStoryboardPrompt(project, videoDesc, assetNames),
        shouldGenerateImage: 1,
        associateAssetsIds: associatedAssets.map((asset) => asset.id),
        sourceTitle,
      });
    }
  }

  return draft.slice(0, 30);
}

async function deleteStoryboards(scriptId: number, projectId: number) {
  const rows = await u.db("o_storyboard").where({ scriptId, projectId }).select("id", "trackId");
  const storyboardIds = rows.map((row: { id?: number | null }) => row.id).filter((id): id is number => typeof id === "number");
  if (!storyboardIds.length) return 0;
  const trackIds = rows.map((row: { trackId?: number | null }) => row.trackId).filter((id): id is number => typeof id === "number");
  await u.db("o_assets2Storyboard").whereIn("storyboardId", storyboardIds).delete();
  await u.db("o_storyboard").whereIn("id", storyboardIds).delete();
  if (trackIds.length) await u.db("o_videoTrack").whereIn("id", Array.from(new Set(trackIds))).delete();
  return storyboardIds.length;
}

async function ensureTrack(projectId: number, scriptId: number, track: string, duration: number) {
  const existing = await u.db("o_storyboard").where({ projectId, scriptId, track }).whereNotNull("trackId").select("trackId").first();
  if (existing?.trackId) {
    await u.db("o_videoTrack").where("id", existing.trackId).update({ duration });
    return Number(existing.trackId);
  }

  let trackId = Date.now();
  while (await u.db("o_videoTrack").where("id", trackId).first()) trackId += 1;
  await u.db("o_videoTrack").insert({
    id: trackId,
    scriptId,
    projectId,
    duration,
  });
  return trackId;
}

async function insertDraftItems(projectId: number, scriptId: number, items: StoryboardDraftItem[], startIndex: number) {
  const trackDuration = items.reduce((sum, item) => sum + item.duration, 0);
  const trackId = await ensureTrack(projectId, scriptId, MAIN_TRACK_NAME, trackDuration);
  const storyboardIds: number[] = [];
  const now = Date.now();

  for (const item of items) {
    const [insertedId] = await u.db("o_storyboard").insert({
      prompt: item.prompt,
      duration: String(item.duration),
      state: "未生成",
      scriptId,
      projectId,
      track: item.track,
      trackId,
      videoDesc: item.videoDesc,
      shouldGenerateImage: item.shouldGenerateImage,
      index: startIndex + item.index,
      createTime: now + item.index,
    });
    const storyboardId = Number(insertedId);
    storyboardIds.push(storyboardId);
    if (item.associateAssetsIds.length) {
      await u.db("o_assets2Storyboard").insert(
        item.associateAssetsIds.map((assetId) => ({
          assetId,
          storyboardId,
        })),
      );
    }
  }

  const allTrackRows = await u.db("o_storyboard").where({ projectId, scriptId, track: MAIN_TRACK_NAME }).select("duration");
  const totalDuration = allTrackRows.reduce((sum: number, row: { duration?: string | null }) => sum + Number(row.duration ?? 0), 0);
  await u.db("o_videoTrack").where("id", trackId).update({ duration: totalDuration });
  return storyboardIds;
}

function buildStoryboardTable(items: StoryboardDraftItem[]) {
  const rows = ["| 镜号 | 时长 | 画面/动作 | 关联资产 |", "| --- | ---: | --- | --- |"];
  for (const item of items) {
    rows.push(`| ${item.index + 1} | ${item.duration}s | ${item.videoDesc.replace(/\|/g, "/")} | ${item.associateAssetsIds.join(", ") || "-"} |`);
  }
  return rows.join("\n");
}

async function upsertProductionWorkData(projectId: number, scriptId: number, scriptContent: string, storyboardTable: string) {
  const existing = await u.db("o_agentWorkData").where({ projectId, episodesId: scriptId, key: "productionAgent" }).first();
  let data: Record<string, any> = {};
  if (existing?.data) {
    try {
      data = JSON.parse(existing.data);
    } catch {
      data = {};
    }
  }

  const nextData = {
    script: nonEmpty(data.script) ?? scriptContent,
    scriptPlan: nonEmpty(data.scriptPlan) ?? "Flova 已基于当前项目小说事件和资产库生成分镜草案。",
    assets: Array.isArray(data.assets) ? data.assets : [],
    storyboardTable,
    storyboard: Array.isArray(data.storyboard) ? data.storyboard : [],
    workbench: data.workbench ?? { videoList: [] },
  };

  if (existing?.id) {
    await u
      .db("o_agentWorkData")
      .where("id", existing.id)
      .update({
        data: JSON.stringify(nextData),
        updateTime: Date.now(),
      });
  } else {
    await u.db("o_agentWorkData").insert({
      projectId,
      episodesId: scriptId,
      key: "productionAgent",
      data: JSON.stringify(nextData),
      createTime: Date.now(),
      updateTime: Date.now(),
    });
  }
}

function shouldForce(sourceText?: string) {
  return /重新|重做|覆盖|替换|清空|再生成|重建/i.test(sourceText ?? "");
}

function shouldAppend(sourceText?: string) {
  return /追加|补充|继续|接着/i.test(sourceText ?? "");
}

export async function generateProjectStoryboardDraft(projectId: number, options: GenerateProjectStoryboardDraftOptions = {}): Promise<GenerateProjectStoryboardDraftResult> {
  const project = (await u.db("o_project").where("id", projectId).first()) as ProjectRow | undefined;
  if (!project?.id) throw new Error("当前项目不存在，无法生成分镜。");

  const [novels, assets] = await Promise.all([
    u.db("o_novel").where("projectId", projectId).select("id", "chapterIndex", "chapter", "chapterData", "event", "eventState").orderBy("chapterIndex", "asc") as Promise<NovelRow[]>,
    u
      .db("o_assets")
      .where("projectId", projectId)
      .whereNull("assetsId")
      .select("id", "name", "type", "describe", "prompt", "imageId")
      .orderByRaw(`CASE type WHEN 'scene' THEN 1 WHEN 'role' THEN 2 WHEN 'tool' THEN 3 ELSE 4 END`)
      .orderBy("id", "asc") as Promise<AssetRow[]>,
  ]);

  const force = options.force ?? shouldForce(options.sourceText);
  const append = options.append ?? shouldAppend(options.sourceText);
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
      storyboardTable,
      message: `当前生产容器「${script.name ?? FLOVA_SCRIPT_NAME}」已有 ${existingCount} 个分镜，已切换到该剧集。需要覆盖重做时请说“重新生成分镜”。`,
    };
  }

  let removedCount = 0;
  if (existingCount > 0 && force) {
    removedCount = await deleteStoryboards(episodesId, projectId);
  }

  const startIndex = append && existingCount > 0 ? existingCount : 0;
  const draftItems = createDraftItems(project, novels, scriptContent, assets);
  if (!draftItems.length) throw new Error("当前项目缺少可用于生成分镜的小说、剧本或项目简介。");

  const storyboardIds = await insertDraftItems(projectId, episodesId, draftItems, startIndex);
  const storyboardTable = buildStoryboardTable(draftItems);
  await upsertProductionWorkData(projectId, episodesId, scriptContent, storyboardTable);

  const verb = removedCount > 0 ? `已覆盖旧分镜 ${removedCount} 个，并重新生成` : append && existingCount > 0 ? "已追加生成" : "已生成";
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
    storyboardTable,
    message: `${verb} ${storyboardIds.length} 个分镜，生产剧集为「${script.name ?? FLOVA_SCRIPT_NAME}」。`,
  };
}
