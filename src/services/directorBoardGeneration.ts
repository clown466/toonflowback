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
  const roleLines = assets.filter(isRoleAsset).map((asset, index) => {
    return [
      `C${index + 1}`,
      `name=${asset.name || "unnamed role"}`,
      `authoritative facts=${compact(asset.roleFacts || asset.prompt || asset.describe || (asset.filePath ? "attached role reference image; extract only visible symbolic identity markers" : ""), 760)}`,
      asset.negativeRoleFacts ? `negative facts=${compact(asset.negativeRoleFacts, 520)}` : "",
    ].join(" | ");
  });
  const sceneLines = assets.filter(isSceneAsset).map((asset, index) => {
    return [
      `Scene ${index + 1}`,
      `name=${asset.name || "unnamed scene"}`,
      `reference=${asset.filePath ? "attached scene reference image is available" : "no image reference"}`,
      `description=${compact(asset.prompt || asset.describe, 620)}`,
    ].join(" | ");
  });

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
    const assets = await getStoryboardAssets(projectId, chunk.map((item) => item.id));
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
  const prompt = buildChapterDirectorBoardPrompt({
    project,
    script,
    boardIndex,
    totalBoards,
    storyboards,
    assets,
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

  void runDirectorBoardImageTask(boardId, { project, script, storyboards, assets, prompt, model });
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
