import u from "@/utils";

export interface ProjectRow {
  id: number;
  name?: string | null;
  intro?: string | null;
  type?: string | null;
  artStyle?: string | null;
  directorManual?: string | null;
  videoRatio?: string | null;
}

export interface NovelRow {
  id: number;
  chapterIndex?: number | null;
  chapter?: string | null;
  chapterData?: string | null;
  event?: string | null;
  eventState?: number | null;
}

export interface ScriptRow {
  id: number;
  name?: string | null;
  content?: string | null;
  projectId?: number | null;
  createTime?: number | null;
}

export interface AssetRow {
  id: number;
  name?: string | null;
  type?: string | null;
  describe?: string | null;
  prompt?: string | null;
  imageId?: number | null;
  filePath?: string | null;
}

export interface StoryboardDraftItem {
  index: number;
  duration: number;
  track: string;
  videoDesc: string;
  prompt: string;
  shouldGenerateImage: number;
  associateAssetsIds: number[];
  sourceTitle: string;
  narrativeFunction?: string;
  pictureDescription?: string;
  role1?: string;
  role1Description?: string;
  role1Image?: string;
  role2?: string;
  role2Description?: string;
  role2Image?: string;
  reference?: string;
  shotSize?: string;
  cameraMove?: string;
  focalLength?: string;
  aperture?: string;
  shutterSpeed?: string;
  iso?: string;
  action?: string;
  emotion?: string;
  scene?: string;
  lighting?: string;
  sound?: string;
  dialogue?: string;
  videoMotionPrompt?: string;
}

export interface GenerateProjectStoryboardDraftOptions {
  sourceText?: string;
  preferredScriptId?: number;
  force?: boolean;
  append?: boolean;
  novelIds?: number[];
  chapterIndexes?: number[];
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
  selectedNovelIds: number[];
  selectedChapterIndexes: number[];
  selectedChapterLabels: string[];
  storyboardTable: string;
  message: string;
  usedSkillId?: string;
  usedSkillName?: string;
  fallbackReason?: string;
  reviewStatus?: "passed" | "warning" | "failed";
  reviewWarnings?: string[];
  reviewFailures?: string[];
  reviewRetryInstruction?: string;
}

export interface ClearProjectStoryboardsOptions {
  sourceText?: string;
  preferredScriptId?: number;
  chapterIndexes?: number[];
}

export interface ClearProjectStoryboardsResult {
  projectId: number;
  cleared: boolean;
  deletedCount: number;
  remainingCount: number;
  targetScripts: Array<{ id: number; name: string; projectId: number; storyboardCount: number }>;
  needsSelection: boolean;
  message: string;
}

export const LEGACY_FLOVA_SCRIPT_NAME = "Flova 原文生产容器";
export const FLOVA_SCRIPT_NAME = "Flova 小说章节工作区";
const MAIN_TRACK_NAME = "主线分镜";

export function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function compactText(value: unknown, maxLength = 600) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}...`;
}

export function cleanName(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function mdCell(value: unknown) {
  const text = String(value ?? "").replace(/\r?\n/g, "<br>").replace(/\|/g, "/").trim();
  return text || "-";
}

export function inferCameraTechnicalSettings(input: {
  shotSize?: string | null;
  cameraMove?: string | null;
  lighting?: string | null;
  action?: string | null;
  focalLength?: string | null;
  aperture?: string | null;
  shutterSpeed?: string | null;
  iso?: string | null;
}) {
  const text = [input.shotSize, input.cameraMove, input.lighting, input.action].map(cleanName).join(" ");
  const isNight = /夜|暗|黑|low[-\s]?light|night|dark|dim/i.test(text);
  const isFast = /快|甩|冲|跑|爆|撞|whip|fast|rush|run|impact|action/i.test(text);
  const isWide = /远景|全景|wide|establishing|overhead|俯视/i.test(text);
  const isClose = /特写|大特写|close|close-up|detail/i.test(text);
  const isMediumClose = /近景|medium close|portrait/i.test(text);

  let focalLength = isClose ? "85mm" : isMediumClose ? "50mm" : isWide ? "24mm" : "35mm";
  let aperture = isClose ? "f/2.8" : isNight ? "f/2.8" : isWide ? "f/5.6" : "f/4";
  let shutterSpeed = isFast ? "1/96" : "1/48";
  let iso = isNight ? "ISO 800" : isWide ? "ISO 400" : "ISO 640";

  focalLength = cleanName(input.focalLength) || focalLength;
  aperture = cleanName(input.aperture) || aperture;
  shutterSpeed = cleanName(input.shutterSpeed) || shutterSpeed;
  iso = cleanName(input.iso) || iso;

  return { focalLength, aperture, shutterSpeed, iso };
}

function listAssetNames(assets: AssetRow[]) {
  return assets.map((asset) => cleanName(asset.name)).filter(Boolean);
}

export function assetDescription(asset?: AssetRow) {
  return compactText(nonEmpty(asset?.prompt) ?? nonEmpty(asset?.describe) ?? nonEmpty(asset?.name) ?? "", 140);
}

function toOssUrl(filePath?: string | null) {
  const raw = String(filePath ?? "").trim();
  if (!raw) return "";
  if (/^(https?:)?\/\//i.test(raw)) return raw;
  if (/^\/(?:oss|smallImage)\//i.test(raw)) return raw;
  return `/oss/${raw.replace(/^[/\\]+/, "")}`;
}

export function assetImageMarkdown(asset?: AssetRow) {
  const url = toOssUrl(asset?.filePath);
  if (!url) return "";
  const alt = cleanName(asset?.name).replace(/[\]\[]/g, "");
  return `![${alt || "asset"}](${url})`;
}

export function summarizeReference(assets: AssetRow[]) {
  const names = listAssetNames(assets);
  if (!names.length) return "";
  return names.map((name) => `参考${name}`).join("、");
}

export function buildStructuredVideoDesc(item: StoryboardDraftItem) {
  const assetIdText = item.associateAssetsIds.length ? item.associateAssetsIds.join("/") : "-";
  const assetNameText = [item.role1, item.role2, item.reference].filter(Boolean).join("/") || "-";
  return `（${[
    item.pictureDescription || item.videoDesc,
    item.scene || "未指定场景",
    assetNameText,
    `${item.duration}s`,
    item.shotSize || "中景",
    item.cameraMove || "静止",
    item.action || item.pictureDescription || item.videoDesc,
    item.emotion || "叙事推进",
    item.lighting || "遵循项目视觉手册光影",
    item.dialogue || "无台词",
    item.sound || "环境音",
    assetIdText,
  ].map(mdCell).join("、")}）`;
}

export function toUniquePositiveNumbers(values: unknown[]) {
  const result: number[] = [];
  for (const value of values) {
    const numberValue = Number(value);
    if (!Number.isInteger(numberValue) || numberValue <= 0 || result.includes(numberValue)) continue;
    result.push(numberValue);
  }
  return result;
}

function chineseNumberToArabic(value: string): number | null {
  const text = value.trim();
  if (/^\d+$/.test(text)) return Number(text);
  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
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
  };
  if (text === "十") return 10;
  const hundredParts = text.split("百");
  let total = 0;
  let rest = text;
  if (hundredParts.length === 2) {
    total += (digits[hundredParts[0]!] ?? 1) * 100;
    rest = hundredParts[1]!;
  }
  const tenParts = rest.split("十");
  if (tenParts.length === 2) {
    total += (tenParts[0] ? digits[tenParts[0]] ?? 0 : 1) * 10;
    total += tenParts[1] ? digits[tenParts[1]] ?? 0 : 0;
    return total > 0 ? total : null;
  }
  if (rest.length === 1 && digits[rest] != null) return total + digits[rest];
  return total > 0 ? total : null;
}

function expandRange(start: number, end: number) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end <= 0) return [];
  const [from, to] = start <= end ? [start, end] : [end, start];
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

function addParsedNumber(target: number[], value: string | undefined) {
  if (!value) return;
  const numberValue = chineseNumberToArabic(value);
  if (numberValue && !target.includes(numberValue)) target.push(numberValue);
}

export function parseStoryboardChapterIndexes(sourceText?: string) {
  const text = sourceText ?? "";
  const indexes: number[] = [];
  const numberToken = String.raw`(\d{1,4}|[零〇一二两三四五六七八九十百]{1,8})`;
  const rangePatterns = [
    new RegExp(String.raw`\bjuben\s*${numberToken}\s*(?:-|~|—|到|至)\s*(?:juben\s*)?${numberToken}\b`, "gi"),
    new RegExp(String.raw`第?\s*${numberToken}\s*(?:章|章节|回)?\s*(?:-|~|—|到|至)\s*第?\s*${numberToken}\s*(?:章|章节|回)`, "gi"),
    new RegExp(String.raw`\bchapters?\s*${numberToken}\s*(?:-|~|—|to)\s*${numberToken}\b`, "gi"),
  ];

  for (const pattern of rangePatterns) {
    for (const match of text.matchAll(pattern)) {
      const start = chineseNumberToArabic(match[1] ?? "");
      const end = chineseNumberToArabic(match[2] ?? "");
      for (const index of expandRange(start ?? 0, end ?? 0)) {
        if (!indexes.includes(index)) indexes.push(index);
      }
    }
  }

  const singlePatterns = [
    new RegExp(String.raw`\bjuben\s*${numberToken}\b`, "gi"),
    new RegExp(String.raw`第\s*${numberToken}\s*(?:章|章节|回)`, "gi"),
    new RegExp(String.raw`${numberToken}\s*(?:章|章节|回)`, "gi"),
    new RegExp(String.raw`\bchapters?\s*${numberToken}\b`, "gi"),
    new RegExp(String.raw`\bch(?:apter)?\.?\s*${numberToken}\b`, "gi"),
  ];

  for (const pattern of singlePatterns) {
    for (const match of text.matchAll(pattern)) addParsedNumber(indexes, match[1]);
  }

  return indexes;
}

function addParsedChapterNameToken(target: string[], value: string | undefined) {
  const token = String(value ?? "").replace(/\s+/g, "").trim();
  if (token && !target.some((item) => item.toLowerCase() === token.toLowerCase())) target.push(token);
}

function parseStoryboardChapterNameTokens(sourceText?: string) {
  const text = sourceText ?? "";
  const tokens: string[] = [];
  const numberToken = String.raw`(\d{1,4})`;
  const rangePattern = new RegExp(String.raw`\bjuben\s*${numberToken}\s*(?:-|~|—|到|至)\s*(?:juben\s*)?${numberToken}\b`, "gi");
  for (const match of text.matchAll(rangePattern)) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    for (const index of expandRange(start, end)) addParsedChapterNameToken(tokens, `juben${index}`);
  }

  const jubenPattern = /\bjuben\s*(\d{1,4})\b/gi;
  for (const match of text.matchAll(jubenPattern)) addParsedChapterNameToken(tokens, `juben${match[1]}`);

  const namedPatterns = [
    /(?:原始名|章节名|chapter)\s*[:：]?\s*["“']([^"”'\n，。；]+)["”']?/gi,
    /(?:原始名|章节名)\s*[:：]?\s*([^\n，。；]+)/g,
  ];
  for (const pattern of namedPatterns) {
    for (const match of text.matchAll(pattern)) addParsedChapterNameToken(tokens, match[1]);
  }

  return tokens;
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

export function parseEvent(event: string | null | undefined) {
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

  const scriptContent = fallbackScripts.map((script) => `${toPublicWorkspaceName(script.name ?? "未命名分镜工作区")}\n${script.content ?? ""}`).join("\n\n").trim();
  if (scriptContent) return scriptContent;
  return [project.name, project.type, project.intro].filter(Boolean).join("\n") || "Flova 自动创建的小说章节工作区";
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

function formatChapterLabel(novel: NovelRow) {
  const index = novel.chapterIndex ?? novel.id;
  const title = cleanName(novel.chapter);
  return `第${index}章${title ? ` ${compactText(title, 24)}` : ""}`;
}

function getProductionScriptName(novels: NovelRow[]) {
  if (novels.length === 1) return `${FLOVA_SCRIPT_NAME} - ${formatChapterLabel(novels[0]!)}`;
  if (novels.length > 1) {
    const indexes = novels.map((novel) => novel.chapterIndex ?? novel.id).filter((index): index is number => typeof index === "number");
    const label = indexes.length ? `第${indexes[0]}-${indexes[indexes.length - 1]}章` : `${novels.length}章`;
    return `${FLOVA_SCRIPT_NAME} - ${label}`;
  }
  return FLOVA_SCRIPT_NAME;
}

function getLegacyProductionScriptName(novels: NovelRow[]) {
  if (novels.length === 1) return `${LEGACY_FLOVA_SCRIPT_NAME} - ${formatChapterLabel(novels[0]!)}`;
  if (novels.length > 1) {
    const indexes = novels.map((novel) => novel.chapterIndex ?? novel.id).filter((index): index is number => typeof index === "number");
    const label = indexes.length ? `第${indexes[0]}-${indexes[indexes.length - 1]}章` : `${novels.length}章`;
    return `${LEGACY_FLOVA_SCRIPT_NAME} - ${label}`;
  }
  return LEGACY_FLOVA_SCRIPT_NAME;
}

export function toPublicWorkspaceName(name: string | null | undefined) {
  const value = String(name ?? FLOVA_SCRIPT_NAME).trim() || FLOVA_SCRIPT_NAME;
  return value.replace(LEGACY_FLOVA_SCRIPT_NAME, FLOVA_SCRIPT_NAME);
}

export function formatChapterSelectionLabel(novel: NovelRow) {
  const index = novel.chapterIndex ?? novel.id;
  const title = cleanName(novel.chapter);
  return title ? `${title}（项目内第${index}条）` : `项目内第${index}条`;
}

export async function ensureProductionScript(project: ProjectRow, novels: NovelRow[], preferredScriptId?: number) {
  const scriptRows = await u.db("o_script").where("projectId", project.id).select("id", "name", "content", "projectId", "createTime").orderBy("id", "asc");
  const scripts: ScriptRow[] = scriptRows.filter((script: { id?: number | null }): script is ScriptRow => typeof script.id === "number");
  const content = buildScriptContent(project, novels, scripts);
  const targetScriptName = getProductionScriptName(novels);
  const legacyTargetScriptName = getLegacyProductionScriptName(novels);

  if (preferredScriptId) {
    const preferred = scripts.find((script) => script.id === preferredScriptId);
    if (preferred && (!novels.length || preferred.name === targetScriptName || preferred.name === legacyTargetScriptName)) {
      if (preferred.name === legacyTargetScriptName) {
        await u.db("o_script").where("id", preferred.id).update({ name: targetScriptName });
        preferred.name = targetScriptName;
      }
      await linkProjectAssetsToScript(project.id, preferred.id);
      return { script: preferred, created: false, content };
    }
  }

  const flovaScript = scripts.find((script) => script.name === targetScriptName || script.name === legacyTargetScriptName);
  if (flovaScript) {
    const update: Partial<ScriptRow> = {};
    if (flovaScript.name === legacyTargetScriptName) update.name = targetScriptName;
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
    name: targetScriptName,
    content,
    projectId: project.id,
    createTime: Date.now(),
  });
  const script: ScriptRow = {
    id: Number(insertedId),
    name: targetScriptName,
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

export function matchAssets(assets: AssetRow[], sourceText: string, maxCount = 7) {
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

export function buildStoryboardPrompt(project: ProjectRow, videoDesc: string, assetNames: string[]) {
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
  const cameraPlans = [
    { shotSize: "远景/全景", cameraMove: "缓推建立", functionName: "定场与冲突建立" },
    { shotSize: "中景/近景", cameraMove: "跟拍或推近", functionName: "动作推进" },
    { shotSize: "特写/运动镜头", cameraMove: "快速切入或轻微摇移", functionName: "反应与转场" },
  ];
  const draft: StoryboardDraftItem[] = [];

  for (const [unitIndex, unit] of units.entries()) {
    const associatedAssets = matchAssets(assets, `${unit.title}\n${unit.assetHint}\n${unit.summary}\n${unit.sourceText}`);
    const associatedAssetNames = associatedAssets.map((asset) => cleanName(asset.name)).filter(Boolean);
    const roleAssets = associatedAssets.filter((asset) => asset.type === "role");
    const sceneAssets = associatedAssets.filter((asset) => asset.type === "scene");
    const propAssets = associatedAssets.filter((asset) => asset.type === "tool");
    const sourceTitle = unit.title || `段落 ${unitIndex + 1}`;

    for (let shotIndex = 0; shotIndex < shotsPerUnit; shotIndex++) {
      const index = draft.length;
      const cameraPlan = cameraPlans[shotIndex] ?? cameraPlans[cameraPlans.length - 1]!;
      const beat =
        shotIndex === 0
          ? `镜头${index + 1}：${sourceTitle}的开场，${unit.summary}`
          : shotIndex === 1
            ? `镜头${index + 1}：${sourceTitle}的核心动作推进，${unit.summary}`
            : `镜头${index + 1}：${sourceTitle}的结果反应和下一段转场，${unit.summary}`;
      const role1 = roleAssets[0];
      const role2 = roleAssets[1];
      const scene = cleanName(sceneAssets[0]?.name) || sourceTitle;
      const sceneAndPropNames = listAssetNames([...sceneAssets, ...propAssets]);
      const reference = sceneAndPropNames.length ? sceneAndPropNames : listAssetNames(associatedAssets);
      const duration = shotIndex === 1 ? 5 : 4;
      const itemBase: StoryboardDraftItem = {
        index,
        duration,
        track: MAIN_TRACK_NAME,
        videoDesc: "",
        prompt: "",
        shouldGenerateImage: 1,
        associateAssetsIds: associatedAssets.map((asset) => asset.id),
        sourceTitle,
        narrativeFunction: cameraPlan.functionName,
        pictureDescription: beat,
        role1: cleanName(role1?.name),
        role1Description: assetDescription(role1),
        role1Image: assetImageMarkdown(role1),
        role2: cleanName(role2?.name),
        role2Description: assetDescription(role2),
        role2Image: assetImageMarkdown(role2),
        reference: reference.join("、"),
        shotSize: cameraPlan.shotSize,
        cameraMove: cameraPlan.cameraMove,
        ...inferCameraTechnicalSettings({
          shotSize: cameraPlan.shotSize,
          cameraMove: cameraPlan.cameraMove,
          lighting: "遵循项目视觉手册，突出主体与冲突",
          action: beat,
        }),
        action: `${beat}｜朝向：按角色关系保持连续`,
        emotion: shotIndex === 0 ? "紧张铺垫" : shotIndex === 1 ? "动作推进" : "反应收束",
        scene,
        lighting: "遵循项目视觉手册，突出主体与冲突",
        sound: shotIndex === 1 ? "动作音 + 环境音" : "环境音",
        dialogue: "无台词",
      };
      const videoDesc = buildStructuredVideoDesc(itemBase);
      itemBase.videoDesc = videoDesc;
      itemBase.prompt = buildStoryboardPrompt(project, videoDesc, associatedAssetNames);
      itemBase.videoMotionPrompt = `${cameraPlan.shotSize}，${cameraPlan.cameraMove}，${beat}，${itemBase.lighting}，${itemBase.sound}`;

      draft.push(itemBase);
    }
  }

  return draft.slice(0, 30);
}

export async function deleteStoryboards(scriptId: number, projectId: number) {
  const rows = await u.db("o_storyboard").where({ scriptId, projectId }).select("id", "trackId");
  const storyboardIds = rows.map((row: { id?: number | null }) => row.id).filter((id): id is number => typeof id === "number");
  if (!storyboardIds.length) return 0;
  const trackIds = rows.map((row: { trackId?: number | null }) => row.trackId).filter((id): id is number => typeof id === "number");
  await u.db("o_assets2Storyboard").whereIn("storyboardId", storyboardIds).delete();
  await u.db("o_storyboard").whereIn("id", storyboardIds).delete();
  if (trackIds.length) await u.db("o_videoTrack").whereIn("id", Array.from(new Set(trackIds))).delete();
  return storyboardIds.length;
}

async function clearProductionWorkDataStoryboards(projectId: number, scriptId: number) {
  const existing = await u.db("o_agentWorkData").where({ projectId, episodesId: scriptId, key: "productionAgent" }).first();
  if (!existing?.id) return;
  let data: Record<string, any> = {};
  if (existing?.data) {
    try {
      data = JSON.parse(existing.data);
    } catch {
      data = {};
    }
  }
  data.storyboardTable = buildStoryboardTable([]);
  data.storyboard = [];
  if (data.workbench && typeof data.workbench === "object") data.workbench.videoList = [];
  await u
    .db("o_agentWorkData")
    .where("id", existing.id)
    .update({
      data: JSON.stringify(data),
      updateTime: Date.now(),
    });
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

export async function insertDraftItems(projectId: number, scriptId: number, items: StoryboardDraftItem[], startIndex: number) {
  const trackDuration = items.reduce((sum, item) => sum + item.duration, 0);
  const trackId = await ensureTrack(projectId, scriptId, MAIN_TRACK_NAME, trackDuration);
  const storyboardIds: number[] = [];
  const now = Date.now();

  for (const item of items) {
    const cameraTech = inferCameraTechnicalSettings(item);
    const [insertedId] = await u.db("o_storyboard").insert({
      prompt: item.prompt,
      duration: String(item.duration),
      state: "未生成",
      scriptId,
      projectId,
      track: item.track,
      trackId,
      videoDesc: item.videoDesc,
      focalLength: cameraTech.focalLength,
      aperture: cameraTech.aperture,
      shutterSpeed: cameraTech.shutterSpeed,
      iso: cameraTech.iso,
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

export function buildStoryboardTable(items: StoryboardDraftItem[]) {
  const rows = [
    "| 镜号 | 时长 | 画面描述 | 角色1 | 角色描述1 | 角色图1 | 角色2 | 角色描述2 | 角色图2 | 参考 | 景别 | 运镜 | 焦距 | 光圈 | 快门 | ISO | 角色动作 | 情绪 | 场景标签 | 光影氛围 | 音效 | 对白 | 分镜提示词 | 视频运动提示词 |",
    "| --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const item of items) {
    const cameraTech = inferCameraTechnicalSettings(item);
    rows.push(`| ${[
      item.index + 1,
      `${item.duration}s`,
      item.pictureDescription || item.videoDesc,
      item.role1,
      item.role1Description,
      item.role1Image,
      item.role2,
      item.role2Description,
      item.role2Image,
      item.reference || (item.associateAssetsIds.length ? `资产ID ${item.associateAssetsIds.join(", ")}` : ""),
      item.shotSize,
      item.cameraMove,
      cameraTech.focalLength,
      cameraTech.aperture,
      cameraTech.shutterSpeed,
      cameraTech.iso,
      item.action,
      item.emotion,
      item.scene,
      item.lighting,
      item.sound,
      item.dialogue || "无台词",
      item.prompt,
      item.videoMotionPrompt || item.videoDesc,
    ].map(mdCell).join(" | ")} |`);
  }
  return rows.join("\n");
}

export async function upsertProductionWorkData(projectId: number, scriptId: number, scriptContent: string, storyboardTable: string) {
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

export function shouldForce(sourceText?: string) {
  return /重新|重做|重推|再次推理|重新推理|覆盖|替换|清空|删除.*重|再生成|重建/i.test(sourceText ?? "");
}

export function shouldAppend(sourceText?: string) {
  return /追加|补充|继续|接着/i.test(sourceText ?? "");
}

export function selectStoryboardNovels(allNovels: NovelRow[], options: GenerateProjectStoryboardDraftOptions) {
  if (!allNovels.length) return [];

  const requestedNovelIds = toUniquePositiveNumbers(options.novelIds ?? []);
  const requestedChapterNameTokens = parseStoryboardChapterNameTokens(options.sourceText);
  const normalizedChapterNameTokens = requestedChapterNameTokens.map((token) => normalizeForMatch(token)).filter(Boolean);
  const requestedChapterIndexes = toUniquePositiveNumbers([...(options.chapterIndexes ?? []), ...parseStoryboardChapterIndexes(options.sourceText)]);

  let selected = allNovels;
  if (requestedNovelIds.length) {
    selected = allNovels.filter((novel) => requestedNovelIds.includes(novel.id));
  } else if (normalizedChapterNameTokens.length) {
    const exactMatches = allNovels.filter((novel) => {
      const chapter = normalizeForMatch(novel.chapter);
      return chapter && normalizedChapterNameTokens.includes(chapter);
    });
    selected = exactMatches.length
      ? exactMatches
      : allNovels.filter((novel) => {
          const chapter = normalizeForMatch(novel.chapter);
          return chapter && normalizedChapterNameTokens.some((token) => chapter.includes(token));
        });
  } else if (requestedChapterIndexes.length) {
    selected = allNovels.filter((novel) => typeof novel.chapterIndex === "number" && requestedChapterIndexes.includes(novel.chapterIndex));
  } else {
    selected = [allNovels[0]!];
  }

  return selected.slice(0, 1);
}

function scriptNameMatchesChapter(scriptName: string | null | undefined, chapterIndexes: number[]) {
  const name = scriptName ?? "";
  return chapterIndexes.some((index) => new RegExp(`第\\s*${index}\\s*章`).test(name) || new RegExp(`juben\\s*${index}\\b`, "i").test(name));
}

async function getProjectScriptsWithStoryboardCounts(projectId: number) {
  const rows = await u
    .db("o_script as s")
    .leftJoin("o_storyboard as sb", function joinStoryboard(this: any) {
      this.on("sb.scriptId", "=", "s.id").andOn("sb.projectId", "=", "s.projectId");
    })
    .where("s.projectId", projectId)
    .select("s.id", "s.name", "s.projectId")
    .count({ storyboardCount: "sb.id" })
    .groupBy("s.id", "s.name", "s.projectId")
    .orderBy("s.id", "asc");

  return rows.map((row: any) => ({
    id: Number(row.id),
    name: toPublicWorkspaceName(row.name ?? "未命名分镜工作区"),
    projectId: Number(row.projectId),
    storyboardCount: Number(row.storyboardCount ?? 0),
  }));
}

export async function clearProjectStoryboards(projectId: number, options: ClearProjectStoryboardsOptions = {}): Promise<ClearProjectStoryboardsResult> {
  const project = (await u.db("o_project").where("id", projectId).first()) as ProjectRow | undefined;
  if (!project?.id) throw new Error("当前项目不存在，无法清空分镜。");

  const requestedChapterIndexes = toUniquePositiveNumbers([...(options.chapterIndexes ?? []), ...parseStoryboardChapterIndexes(options.sourceText)]);
  const scripts = await getProjectScriptsWithStoryboardCounts(projectId);
  const scriptsWithStoryboards = scripts.filter((script) => script.storyboardCount > 0);
  const flovaScriptsWithStoryboards = scriptsWithStoryboards.filter((script) => script.name.startsWith(FLOVA_SCRIPT_NAME));

  let targetScripts = scriptsWithStoryboards;
  if (options.preferredScriptId) targetScripts = scriptsWithStoryboards.filter((script) => script.id === options.preferredScriptId);
  if (!options.preferredScriptId && requestedChapterIndexes.length) targetScripts = scriptsWithStoryboards.filter((script) => scriptNameMatchesChapter(script.name, requestedChapterIndexes));
  if (!options.preferredScriptId && !requestedChapterIndexes.length && flovaScriptsWithStoryboards.length === 1) targetScripts = flovaScriptsWithStoryboards;

  if (!targetScripts.length) {
    return {
      projectId,
      cleared: false,
      deletedCount: 0,
      remainingCount: scriptsWithStoryboards.reduce((sum, script) => sum + script.storyboardCount, 0),
      targetScripts: scriptsWithStoryboards,
      needsSelection: scriptsWithStoryboards.length > 1,
      message: scriptsWithStoryboards.length
        ? `没有匹配到要清空的章节分镜工作区。当前有分镜的工作区：${scriptsWithStoryboards.map((script) => `${toPublicWorkspaceName(script.name)}（ID: ${script.id}，${script.storyboardCount}条）`).join("；")}。`
        : "当前项目没有可清空的分镜。",
    };
  }

  if (!options.preferredScriptId && !requestedChapterIndexes.length && targetScripts.length > 1) {
    return {
      projectId,
      cleared: false,
      deletedCount: 0,
      remainingCount: scriptsWithStoryboards.reduce((sum, script) => sum + script.storyboardCount, 0),
      targetScripts,
      needsSelection: true,
      message: `当前有多个章节分镜工作区含分镜，请指定要清空的章节：${targetScripts.map((script) => `${toPublicWorkspaceName(script.name)}（ID: ${script.id}，${script.storyboardCount}条）`).join("；")}。`,
    };
  }

  let deletedCount = 0;
  for (const script of targetScripts) {
    deletedCount += await deleteStoryboards(script.id, projectId);
    await clearProductionWorkDataStoryboards(projectId, script.id);
  }

  const remainingCountRow = await u.db("o_storyboard").where("projectId", projectId).count({ count: "id" }).first();
  const remainingCount = Number((remainingCountRow as any)?.count ?? 0);
  return {
    projectId,
    cleared: true,
    deletedCount,
    remainingCount,
    targetScripts,
    needsSelection: false,
    message: `已清空 ${targetScripts.map((script) => `「${toPublicWorkspaceName(script.name)}」`).join("、")} 的 ${deletedCount} 条分镜。`,
  };
}

export async function generateProjectStoryboardDraft(projectId: number, options: GenerateProjectStoryboardDraftOptions = {}): Promise<GenerateProjectStoryboardDraftResult> {
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
  const requestedChapterIndexes = toUniquePositiveNumbers([...(options.chapterIndexes ?? []), ...parseStoryboardChapterIndexes(options.sourceText)]);
  const requestedNovelIds = toUniquePositiveNumbers(options.novelIds ?? []);
  const requestedChapterNameTokens = parseStoryboardChapterNameTokens(options.sourceText);
  const novels = selectStoryboardNovels(allNovels, options);
  if (allNovels.length && (requestedChapterIndexes.length || requestedNovelIds.length || requestedChapterNameTokens.length) && !novels.length) {
    const requestedParts = [
      requestedChapterNameTokens.length ? `原始章节名 ${requestedChapterNameTokens.join(", ")}` : "",
      requestedChapterIndexes.length ? `内部章节 ${requestedChapterIndexes.join(", ")}` : "",
      requestedNovelIds.length ? `小说记录 ${requestedNovelIds.join(", ")}` : "",
    ].filter(Boolean);
    const requested = requestedParts.join(" 或 ");
    throw new Error(`没有匹配到${requested}，已停止生成，避免把其他章节误写入分镜。`);
  }

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

  let removedCount = 0;
  if (existingCount > 0 && force) {
    removedCount = await deleteStoryboards(episodesId, projectId);
  }

  const startIndex = append && existingCount > 0 ? existingCount : 0;
  const draftItems = createDraftItems(project, novels, scriptContent, assets);
  if (!draftItems.length) throw new Error("当前项目缺少可用于生成分镜的小说章节、事件分析或项目简介。");

  const storyboardIds = await insertDraftItems(projectId, episodesId, draftItems, startIndex);
  const storyboardTable = buildStoryboardTable(draftItems);
  await upsertProductionWorkData(projectId, episodesId, scriptContent, storyboardTable);

  const verb = removedCount > 0 ? `已覆盖旧分镜 ${removedCount} 个，并重新生成` : append && existingCount > 0 ? "已追加生成" : "已生成";
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
    message: `${verb} ${storyboardIds.length} 个分镜，章节分镜工作区为「${toPublicWorkspaceName(script.name)}」。已按单章节隔离处理，未把后续章节并入上下文。`,
  };
}
