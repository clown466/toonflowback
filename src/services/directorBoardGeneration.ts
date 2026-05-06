import u from "@/utils";
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
}

interface DirectorBoardRow {
  id: number;
  projectId: number;
  scriptId: number;
  name?: string | null;
  prompt?: string | null;
  filePath?: string | null;
  state?: string | null;
  reason?: string | null;
  model?: string | null;
  storyboardIds?: string | null;
  assetIds?: string | null;
  index?: number | null;
}

export interface QueueDirectorBoardOptions {
  storyboardIds?: number[];
  model?: string;
  shotsPerBoard?: number;
  replace?: boolean;
}

function compact(value: unknown, maxLength = 800) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}...`;
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
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

export function buildChapterDirectorBoardPrompt(input: {
  project: ProjectRow;
  script: ScriptRow;
  boardIndex: number;
  totalBoards: number;
  storyboards: StoryboardRow[];
  assets: AssetRow[];
}) {
  const { project, script, boardIndex, totalBoards, storyboards, assets } = input;
  const startSecond = storyboards.reduce((sum, shot, index) => (index === 0 ? 0 : sum + parseDuration(storyboards[index - 1]?.duration)), 0);
  let cursor = startSecond;
  const shotLines = storyboards.map((shot) => {
    const duration = parseDuration(shot.duration);
    const start = cursor;
    cursor += duration;
    return [
      `Shot ${String((shot.index ?? 0) + 1).padStart(2, "0")}`,
      `${start}-${cursor}s`,
      `videoDesc: ${compact(shot.videoDesc, 700)}`,
      `keyframe prompt: ${compact(shot.prompt, 500)}`,
    ].join(" | ");
  });

  const assetLines = assets.map((asset, index) => {
    return [
      `Ref ${index + 1}`,
      `id=${asset.id}`,
      `type=${asset.type || "asset"}`,
      `name=${asset.name || "unnamed"}`,
      `description=${compact(asset.prompt || asset.describe, 360)}`,
    ].join(" | ");
  });

  return [
    "Create one professional cinematic chapter director board as a single wide 16:9 production planning sheet.",
    "This image is NOT the final video frame. It is a director planning board for video-generation reference.",
    "",
    "Primary goal:",
    "Show spatial continuity, camera blocking, character positions, face/state consistency, scene layout, shot order, and lighting continuity across multiple video clips.",
    "",
    "Required layout:",
    "1. Top black header bar: project title, chapter/workspace name, board number, covered shots, total estimated time, video aspect ratio, visual style keywords.",
    "2. Left column: scene reference panel and character lineup panel based on the provided reference images.",
    "3. Center top: overhead blocking map, showing scene layout, character positions, camera positions, movement arrows, eye lines, and light direction.",
    "4. Center bottom: sequential storyboard strip with 4-6 panels. Each panel must include shot number, time range, shot size, camera movement, and the core action.",
    "5. Right column: simplified action-flow sketches from shot to shot, focusing on body position, direction, distance, and continuity.",
    "6. Bottom strip: lighting, props, materials, color palette, and continuity notes.",
    "",
    "Visual style:",
    "clean production storyboard sheet, thin black grid lines, white paper background, readable small labels, cinematic storyboard sketches mixed with rendered reference thumbnails, practical director annotations, no UI, no watermark.",
    "",
    "Consistency rules:",
    "Use the provided character and scene reference images as identity anchors.",
    "Do not redesign characters. Keep faces, body type, costumes, props, and scene architecture consistent.",
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

async function getStoryboardAssets(storyboardIds: number[]) {
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
  return result;
}

async function runDirectorBoardImageTask(rowId: number, data: { project: ProjectRow; script: ScriptRow; storyboards: StoryboardRow[]; assets: AssetRow[]; prompt: string; model: string }) {
  const { project, script, storyboards, assets, prompt, model } = data;
  const savePath = `/${project.id}/directorBoard/${script.id}/${uuidv4()}.jpg`;
  try {
    const image = await u.Ai.Image(model as `${string}:${string}`).run(
      {
        prompt,
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
    const assets = await getStoryboardAssets(chunk.map((item) => item.id));
    const prompt = buildChapterDirectorBoardPrompt({
      project,
      script,
      boardIndex,
      totalBoards: chunks.length,
      storyboards: chunk,
      assets,
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
    void runDirectorBoardImageTask(Number(rowId), { project, script, storyboards: chunk, assets, prompt, model });
  }

  return created;
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
