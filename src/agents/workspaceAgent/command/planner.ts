import { resolveWorkspaceScope } from "@/agents/workspaceAgent/command/scopeResolver";
import type {
  WorkspaceMissingInfo,
  WorkspaceProjectSnapshot,
  WorkspaceResolvedScope,
  WorkspaceScopeCandidate,
} from "@/agents/workspaceAgent/command/types";

export type WorkspaceCommandIntent = "asset_image_generation" | "storyboard_generation" | "storyboard_clear" | "asset_extraction";

export type WorkspaceCommandRiskLevel = "read" | "plan" | "write" | "cost";

export type WorkspaceCommandConfirmationPolicy = "auto" | "confirm" | "missingInfo";

export type WorkspaceExecutorName =
  | "runProjectAssetImageGenerationFastPath"
  | "runProjectStoryboardDraftFastPath"
  | "runProjectStoryboardClearFastPath"
  | "runNovelAssetExtractionFastPath";

export type WorkspaceAssetType = "role" | "scene" | "tool";

export interface WorkspaceResolvedChapterCandidate {
  id?: number;
  chapterIndex?: number;
  chapter?: string | null;
  label?: string;
  confidence?: number;
  reason?: string;
  score?: number;
}

export interface WorkspacePlannerResolvedScope {
  kind?: "project" | "chapter" | "scene" | "asset" | "storyboard" | "unknown";
  assetType?: WorkspaceAssetType;
  limit?: number;
  assetIds?: number[];
  assetNames?: string[];
  includeCompleted?: boolean;
  onlyFailed?: boolean;
  force?: boolean;
  append?: boolean;
  chapterIndexes?: number[];
  chapterIds?: number[];
  skillId?: string;
  chapterCandidates?: WorkspaceResolvedChapterCandidate[];
  missingInfo?: string[];
  confidence?: number;
  summary?: string;
}

export interface WorkspaceCommandSnapshot {
  project?: WorkspaceProjectSnapshot["project"];
  assets?: WorkspaceProjectSnapshot["assets"];
  scripts?: WorkspaceProjectSnapshot["scripts"];
  imageGenerationSkills?: WorkspaceProjectSnapshot["imageGenerationSkills"];
  scopeResolution?: WorkspaceResolvedScope | WorkspacePlannerResolvedScope | null;
  chapters?: WorkspaceResolvedChapterCandidate[];
  novels?: Array<WorkspaceResolvedChapterCandidate | WorkspaceProjectSnapshot["novels"][number]>;
  currentScriptId?: number;
  currentEpisodesId?: number;
}

export interface WorkspaceCommandScope {
  kind: "project" | "chapter" | "scene" | "asset" | "storyboard" | "unknown";
  assetType?: WorkspaceAssetType;
  limit?: number;
  assetIds?: number[];
  assetNames?: string[];
  includeCompleted?: boolean;
  onlyFailed?: boolean;
  force?: boolean;
  append?: boolean;
  chapterIndexes?: number[];
  chapterIds?: number[];
  skillId?: string;
  chapterCandidates?: WorkspaceResolvedChapterCandidate[];
  missingInfo?: Array<WorkspaceMissingInfo | string>;
  confidence?: number;
  summary: string;
}

export interface WorkspaceCommandPreflightSummary {
  intent: WorkspaceCommandIntent;
  scopeText: string;
  quantityText: string;
  includeCompleted: boolean;
  redraw: boolean;
  confirmationPolicy: WorkspaceCommandConfirmationPolicy;
  message: string;
}

export interface WorkspaceCommandPlan {
  intent: WorkspaceCommandIntent;
  riskLevel: WorkspaceCommandRiskLevel;
  confirmationPolicy: WorkspaceCommandConfirmationPolicy;
  scope: WorkspaceCommandScope;
  preflightSummary: WorkspaceCommandPreflightSummary;
  executor: {
    name: WorkspaceExecutorName;
    options: Record<string, unknown>;
  };
  sourceText: string;
  userRequirement?: string;
  signals: string[];
}

interface IntentSignal {
  intent: WorkspaceCommandIntent;
  confidence: number;
  signals: string[];
}

const NUMBER_TOKEN = String.raw`(\d{1,3}|[零〇一二两三四五六七八九十百]{1,8})`;

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
  let total = 0;
  let rest = text;
  const hundredParts = rest.split("百");
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

function normalizePositiveLimit(value: unknown): number | undefined {
  const numberValue = typeof value === "string" ? chineseNumberToArabic(value) : Number(value);
  if (!Number.isInteger(numberValue) || Number(numberValue) <= 0) return undefined;
  return Math.min(Number(numberValue), 100);
}

function compactUnique<T>(values: Array<T | null | undefined>): T[] {
  return Array.from(new Set(values.filter((value): value is T => value != null)));
}

function hasAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function detectIntent(text: string): IntentSignal | null {
  const storyboardRegeneration =
    /(确认|确定|执行|开始)?.{0,8}(删除|删掉|清空|清除|覆盖|重置).{0,12}(重新推理|重推|重新生成|重做|重建)/i.test(text) ||
    /(重新推理|重推).{0,12}(分镜|镜头|storyboard)/i.test(text);
  if (storyboardRegeneration) {
    return {
      intent: "storyboard_generation",
      confidence: 0.92,
      signals: ["legacy_regex:storyboard_regeneration"],
    };
  }

  const storyboardClear =
    /(清空|清除|删除|删掉|移除|重置).{0,12}(分镜|镜头|storyboard)|(分镜|镜头|storyboard).{0,12}(清空|清除|删除|删掉|移除|重置)/i.test(text);
  if (storyboardClear) {
    return {
      intent: "storyboard_clear",
      confidence: 0.95,
      signals: ["legacy_regex:storyboard_clear"],
    };
  }

  const storyboardGeneration =
    /(分镜|镜头|storyboard|镜号|shot list)/i.test(text) &&
    /(出|生成|做|创建|规划|拆|整理|帮我|开始|直接|一键|一句话|生产)/i.test(text);
  if (storyboardGeneration) {
    return {
      intent: "storyboard_generation",
      confidence: 0.88,
      signals: ["legacy_regex:storyboard_generation"],
    };
  }

  const explicitAssetImageIntent =
    /(资产|角色|场景|道具|参考图).*(出图|生图|生成.*图|批量.*图|图片)|(出图|生图|生成.*图).*(资产|角色|场景|道具|参考图)/i.test(text);
  const genericBatchImageIntent =
    /(批量|全部|所有|统一|帮我|开始|直接).{0,16}(出图|生图|生成.*图)|(出图|生图).{0,16}(批量|全部|所有|统一)/i.test(text) &&
    !/(分镜|镜头|storyboard|视频)/i.test(text);
  const vagueImageIntent = /帮我.{0,8}(出图|生图|生成.*图)|(出图|生图)$/i.test(text) && !/(分镜|镜头|storyboard|视频)/i.test(text);
  if (explicitAssetImageIntent || genericBatchImageIntent || vagueImageIntent) {
    return {
      intent: "asset_image_generation",
      confidence: explicitAssetImageIntent || genericBatchImageIntent ? 0.88 : 0.55,
      signals: [
        explicitAssetImageIntent ? "legacy_regex:explicit_asset_image_generation" : null,
        genericBatchImageIntent ? "legacy_regex:generic_batch_image_generation" : null,
        vagueImageIntent ? "intent_signal:vague_image_generation" : null,
      ].filter((signal): signal is string => Boolean(signal)),
    };
  }

  const assetExtraction = /提取?资产|提资产|资产库|角色.*场景.*道具|塑角造景|准备资产/i.test(text);
  if (assetExtraction) {
    return {
      intent: "asset_extraction",
      confidence: 0.86,
      signals: ["legacy_regex:asset_extraction"],
    };
  }

  return null;
}

function parseAssetTypeFromText(text: string): WorkspaceAssetType | undefined {
  const matched: WorkspaceAssetType[] = [];
  if (/(角色|人物|主角|配角|character)/i.test(text)) matched.push("role");
  if (/(场景|环境|地点|空间|scene|environment|location)/i.test(text)) matched.push("scene");
  if (/(道具|物品|工具|prop|props)/i.test(text)) matched.push("tool");
  return matched.length === 1 ? matched[0] : undefined;
}

function parseLimitFromText(text: string): number | undefined {
  const patterns = [
    new RegExp(String.raw`前\s*${NUMBER_TOKEN}\s*(?:个|张|幅|组)?\s*(?:角色|人物|场景|环境|道具|物品|资产|参考图|图片|图)`, "i"),
    new RegExp(String.raw`(?:生成|提交|出|生|做)\s*前?\s*${NUMBER_TOKEN}\s*(?:个|张|幅|组)?\s*(?:角色|人物|场景|环境|道具|物品|资产|参考图|图片|图)`, "i"),
    new RegExp(String.raw`${NUMBER_TOKEN}\s*(?:个|张|幅|组)\s*(?:角色|人物|场景|环境|道具|物品|资产|参考图|图片|图)`, "i"),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const limit = normalizePositiveLimit(match?.[1]);
    if (limit) return limit;
  }
  return undefined;
}

function parseIncludeCompletedFromText(text: string) {
  return /includeCompleted/i.test(text) || /(重新|重绘|重出|再生成|覆盖|替换)/i.test(text) || /(包含|包括|连同|也要|一起).*(已完成|完成的|已有图|已经出图|出过图)/.test(text);
}

function parseSkillIdFromText(text: string) {
  return text.match(/\bskillId\s*[:：=]\s*([a-zA-Z0-9_-]{1,80})\b/i)?.[1];
}

function parseChapterIndexesFromText(text: string): number[] {
  const indexes: number[] = [];
  const rangePattern = new RegExp(String.raw`第?\s*${NUMBER_TOKEN}\s*(?:章|章节|集|条)?\s*(?:到|至|-|~)\s*第?\s*${NUMBER_TOKEN}\s*(?:章|章节|集|条)?`, "gi");
  for (const match of text.matchAll(rangePattern)) {
    const start = normalizePositiveLimit(match[1]);
    const end = normalizePositiveLimit(match[2]);
    if (!start || !end) continue;
    const min = Math.min(start, end);
    const max = Math.max(start, end);
    for (let index = min; index <= max && indexes.length < 100; index += 1) indexes.push(index);
  }

  const singlePattern = new RegExp(String.raw`第?\s*${NUMBER_TOKEN}\s*(?:章|章节|集|条)`, "gi");
  for (const match of text.matchAll(singlePattern)) {
    const index = normalizePositiveLimit(match[1]);
    if (index) indexes.push(index);
  }

  return compactUnique(indexes).sort((a, b) => a - b);
}

function isProjectSnapshot(snapshot?: WorkspaceCommandSnapshot): snapshot is WorkspaceCommandSnapshot & WorkspaceProjectSnapshot {
  return Boolean(snapshot?.project && Array.isArray(snapshot.novels) && Array.isArray(snapshot.assets) && Array.isArray(snapshot.scripts));
}

function getResolvedScope(text: string, snapshot?: WorkspaceCommandSnapshot): WorkspaceResolvedScope | WorkspacePlannerResolvedScope | null {
  if (snapshot?.scopeResolution) return snapshot.scopeResolution;
  if (isProjectSnapshot(snapshot)) return resolveWorkspaceScope(text, snapshot);
  return null;
}

function isWorkspaceResolvedScope(scope: WorkspaceResolvedScope | WorkspacePlannerResolvedScope | null | undefined): scope is WorkspaceResolvedScope {
  return Boolean(scope && "assetImages" in scope && "chapters" in scope && "missingInfo" in scope);
}

function mapScopeCandidates(candidates?: WorkspaceScopeCandidate[]): WorkspaceResolvedChapterCandidate[] {
  return (candidates ?? []).map((candidate) => ({
    id: candidate.id,
    label: candidate.label,
    confidence: candidate.score,
    score: candidate.score,
  }));
}

function normalizeChapterCandidates(candidates?: Array<WorkspaceResolvedChapterCandidate | WorkspaceProjectSnapshot["novels"][number]>): WorkspaceResolvedChapterCandidate[] {
  return (candidates ?? []).map((candidate) => ({
    id: candidate.id,
    chapterIndex: candidate.chapterIndex ?? undefined,
    chapter: candidate.chapter ?? undefined,
    label: "label" in candidate ? candidate.label : undefined,
    confidence: "confidence" in candidate ? candidate.confidence : undefined,
    reason: "reason" in candidate ? candidate.reason : undefined,
    score: "score" in candidate ? candidate.score : undefined,
  }));
}

function missingInfoReasons(missingInfo?: Array<WorkspaceMissingInfo | string>) {
  return (missingInfo ?? []).map((item) => (typeof item === "string" ? item : item.reason));
}

function resolveChapterCandidates(text: string, snapshot?: WorkspaceCommandSnapshot) {
  const resolved = getResolvedScope(text, snapshot);
  if (isWorkspaceResolvedScope(resolved)) {
    const parsedIndexes = parseChapterIndexesFromText(text);
    const idsFromParsedIndexes = normalizeChapterCandidates(snapshot?.novels)
      .filter((candidate) => candidate.chapterIndex != null && parsedIndexes.includes(candidate.chapterIndex))
      .map((candidate) => candidate.id);
    return {
      chapterIndexes: parsedIndexes,
      chapterIds: compactUnique([...resolved.chapters.novelIds, ...idsFromParsedIndexes]),
      chapterCandidates: mapScopeCandidates(resolved.chapters.candidates),
    };
  }
  const parsedIndexes = parseChapterIndexesFromText(text);
  const sourceCandidates = normalizeChapterCandidates(resolved?.chapterCandidates ?? snapshot?.chapters ?? snapshot?.novels);
  const candidateIndexes = compactUnique(sourceCandidates.map((candidate) => candidate.chapterIndex));
  const chapterIndexes = compactUnique([...(resolved?.chapterIndexes ?? []), ...parsedIndexes, ...candidateIndexes]).sort((a, b) => a - b);
  const chapterIds = compactUnique([...(resolved?.chapterIds ?? []), ...sourceCandidates.map((candidate) => candidate.id)]);
  return {
    chapterIndexes,
    chapterIds,
    chapterCandidates: sourceCandidates,
  };
}

function normalizeMissingInfoForResolvedChapter(
  missingInfo: Array<WorkspaceMissingInfo | string> | undefined,
  chapters: ReturnType<typeof resolveChapterCandidates>,
) {
  if (!missingInfo?.length) return missingInfo;
  if (!chapters.chapterIds.length && !chapters.chapterIndexes.length) return missingInfo;
  return missingInfo.filter((item) => typeof item === "string" || item.field !== "chapter");
}

function assetTypeLabel(assetType?: WorkspaceAssetType) {
  if (assetType === "role") return "角色";
  if (assetType === "scene") return "场景";
  if (assetType === "tool") return "道具";
  return "资产";
}

function summarizeScope(scope: Omit<WorkspaceCommandScope, "summary">): string {
  const parts: string[] = [];
  if (scope.kind === "scene") parts.push("场景资产");
  else if (scope.kind === "asset") parts.push(assetTypeLabel(scope.assetType));
  else if (scope.kind === "chapter") parts.push("章节");
  else if (scope.kind === "storyboard") parts.push("分镜");
  else parts.push("项目");

  if (scope.limit) parts.push(`前 ${scope.limit} 个`);
  if (scope.chapterIndexes?.length) parts.push(`第 ${scope.chapterIndexes.join("、")} 章/条候选`);
  if (scope.assetIds?.length) parts.push(`资产 ID ${scope.assetIds.join(", ")}`);
  if (scope.assetNames?.length) parts.push(`资产名称 ${scope.assetNames.join("、")}`);
  if (scope.missingInfo?.length) parts.push(`缺少：${missingInfoReasons(scope.missingInfo).join("、")}`);
  return parts.join("，");
}

function buildPreflightSummary(args: {
  intent: WorkspaceCommandIntent;
  scope: WorkspaceCommandScope;
  confirmationPolicy: WorkspaceCommandConfirmationPolicy;
  message: string;
}): WorkspaceCommandPreflightSummary {
  const explicitCount = args.scope.assetIds?.length || args.scope.assetNames?.length || args.scope.limit;
  return {
    intent: args.intent,
    scopeText: args.scope.summary,
    quantityText: explicitCount ? `最多/指定 ${explicitCount} 个` : "由执行器按当前项目数据决定",
    includeCompleted: Boolean(args.scope.includeCompleted),
    redraw: Boolean(args.scope.includeCompleted),
    confirmationPolicy: args.confirmationPolicy,
    message: args.message,
  };
}

function buildAssetImagePlan(text: string, signal: IntentSignal, snapshot?: WorkspaceCommandSnapshot): WorkspaceCommandPlan {
  const resolved = getResolvedScope(text, snapshot);
  const assetScope = isWorkspaceResolvedScope(resolved) ? resolved.assetImages : resolved;
  const parsedAssetType = parseAssetTypeFromText(text);
  const assetType = assetScope?.assetType ?? parsedAssetType;
  const limit = normalizePositiveLimit(assetScope?.limit) ?? parseLimitFromText(text);
  const includeCompleted = assetScope?.includeCompleted ?? parseIncludeCompletedFromText(text);
  const skillId = parseSkillIdFromText(text);
  const missingInfo: Array<WorkspaceMissingInfo | string> = [...((isWorkspaceResolvedScope(resolved) ? resolved.missingInfo : resolved?.missingInfo) ?? [])];
  const isVague = signal.confidence < 0.7 || (!assetType && !limit && !assetScope?.assetIds?.length && !assetScope?.assetNames?.length && /帮我.{0,8}(出图|生图|生成.*图)|(出图|生图)$/i.test(text));
  if (isVague && !missingInfo.length) missingInfo.push("需要确认资产类型或生成范围");

  const scopeBase: Omit<WorkspaceCommandScope, "summary"> = {
    kind: assetType === "scene" ? "scene" : "asset",
    assetType,
    limit,
    assetIds: assetScope?.assetIds,
    assetNames: assetScope?.assetNames,
    includeCompleted,
    onlyFailed: assetScope?.onlyFailed,
    skillId,
    missingInfo,
    confidence: isWorkspaceResolvedScope(resolved) ? signal.confidence : resolved?.confidence ?? signal.confidence,
  };
  const scope: WorkspaceCommandScope = {
    ...scopeBase,
    summary: isWorkspaceResolvedScope(resolved) ? summarizeScope(scopeBase) : resolved?.summary ?? summarizeScope(scopeBase),
  };
  const confirmationPolicy: WorkspaceCommandConfirmationPolicy = missingInfo.length ? "missingInfo" : signal.confidence >= 0.8 ? "auto" : "confirm";
  const preflightMessage =
    confirmationPolicy === "auto"
      ? `准备提交${scope.summary}的资产出图任务。`
      : `识别到资产出图意图，但${missingInfoReasons(missingInfo).join("、") || "范围不够明确"}，需要先确认。`;

  return {
    intent: signal.intent,
    riskLevel: "cost",
    confirmationPolicy,
    scope,
    preflightSummary: buildPreflightSummary({ intent: signal.intent, scope, confirmationPolicy, message: preflightMessage }),
    executor: {
      name: "runProjectAssetImageGenerationFastPath",
      options: {
        sourceText: text,
        assetType,
        limit,
        assetIds: assetScope?.assetIds,
        assetNames: assetScope?.assetNames,
        includeCompleted,
        skillId,
        disableNaturalLanguageScopeParsing: true,
      },
    },
    sourceText: text,
    signals: signal.signals,
  };
}

function buildStoryboardPlan(text: string, signal: IntentSignal, snapshot?: WorkspaceCommandSnapshot): WorkspaceCommandPlan {
  const resolved = getResolvedScope(text, snapshot);
  const chapters = resolveChapterCandidates(text, snapshot);
  const missingInfo = normalizeMissingInfoForResolvedChapter(isWorkspaceResolvedScope(resolved) ? resolved.missingInfo : resolved?.missingInfo, chapters);
  const skillId = parseSkillIdFromText(text);
  const force = /(重新|重做|覆盖|替换|清空|清除|删除|删掉|重置|再生成|重建|重新推理|重推)/i.test(text);
  const scopeBase: Omit<WorkspaceCommandScope, "summary"> = {
    kind: "chapter",
    chapterIndexes: chapters.chapterIndexes,
    chapterIds: chapters.chapterIds,
    skillId,
    force,
    chapterCandidates: chapters.chapterCandidates,
    missingInfo,
    confidence: isWorkspaceResolvedScope(resolved) ? signal.confidence : resolved?.confidence ?? signal.confidence,
  };
  const scope: WorkspaceCommandScope = {
    ...scopeBase,
    summary: isWorkspaceResolvedScope(resolved) ? summarizeScope(scopeBase) : resolved?.summary ?? summarizeScope(scopeBase),
  };
  const confirmationPolicy: WorkspaceCommandConfirmationPolicy = missingInfo?.length ? "missingInfo" : "auto";
  const preflightMessage = `准备按${scope.summary}生成章节分镜草案。`;

  return {
    intent: "storyboard_generation",
    riskLevel: "write",
    confirmationPolicy,
    scope,
    preflightSummary: buildPreflightSummary({ intent: "storyboard_generation", scope, confirmationPolicy, message: preflightMessage }),
    executor: {
      name: "runProjectStoryboardDraftFastPath",
      options: {
        sourceText: text,
        preferredScriptId: snapshot?.currentScriptId,
        force,
        novelIds: chapters.chapterIds,
        chapterIndexes: chapters.chapterIndexes,
        skillId,
        userRequirement: text,
      },
    },
    sourceText: text,
    userRequirement: text,
    signals: signal.signals,
  };
}

function buildStoryboardClearPlan(text: string, signal: IntentSignal, snapshot?: WorkspaceCommandSnapshot): WorkspaceCommandPlan {
  const resolved = getResolvedScope(text, snapshot);
  const chapters = resolveChapterCandidates(text, snapshot);
  const missingInfo = normalizeMissingInfoForResolvedChapter(isWorkspaceResolvedScope(resolved) ? resolved.missingInfo : resolved?.missingInfo, chapters);
  const scopeBase: Omit<WorkspaceCommandScope, "summary"> = {
    kind: "storyboard",
    chapterIndexes: chapters.chapterIndexes,
    chapterIds: chapters.chapterIds,
    chapterCandidates: chapters.chapterCandidates,
    missingInfo,
    confidence: isWorkspaceResolvedScope(resolved) ? signal.confidence : resolved?.confidence ?? signal.confidence,
  };
  const scope: WorkspaceCommandScope = {
    ...scopeBase,
    summary: isWorkspaceResolvedScope(resolved) ? summarizeScope(scopeBase) : resolved?.summary ?? summarizeScope(scopeBase),
  };
  const preflightMessage = `准备清空${scope.summary}。该操作会删除章节分镜，执行前应确认。`;

  return {
    intent: "storyboard_clear",
    riskLevel: "write",
    confirmationPolicy: "confirm",
    scope,
    preflightSummary: buildPreflightSummary({ intent: "storyboard_clear", scope, confirmationPolicy: "confirm", message: preflightMessage }),
    executor: {
      name: "runProjectStoryboardClearFastPath",
      options: {
        sourceText: text,
        preferredScriptId: snapshot?.currentScriptId,
      },
    },
    sourceText: text,
    signals: signal.signals,
  };
}

function buildAssetExtractionPlan(text: string, signal: IntentSignal, snapshot?: WorkspaceCommandSnapshot): WorkspaceCommandPlan {
  const resolved = getResolvedScope(text, snapshot);
  const chapters = resolveChapterCandidates(text, snapshot);
  const missingInfo = normalizeMissingInfoForResolvedChapter(isWorkspaceResolvedScope(resolved) ? resolved.missingInfo : resolved?.missingInfo, chapters);
  const scopeBase: Omit<WorkspaceCommandScope, "summary"> = {
    kind: chapters.chapterIndexes.length || chapters.chapterCandidates.length ? "chapter" : "project",
    chapterIndexes: chapters.chapterIndexes,
    chapterIds: chapters.chapterIds,
    chapterCandidates: chapters.chapterCandidates,
    missingInfo,
    confidence: isWorkspaceResolvedScope(resolved) ? signal.confidence : resolved?.confidence ?? signal.confidence,
  };
  const scope: WorkspaceCommandScope = {
    ...scopeBase,
    summary: isWorkspaceResolvedScope(resolved) ? summarizeScope(scopeBase) : resolved?.summary ?? summarizeScope(scopeBase),
  };
  const confirmationPolicy: WorkspaceCommandConfirmationPolicy = missingInfo?.length ? "missingInfo" : "auto";
  const preflightMessage = `准备从${scope.summary}提取角色、场景和道具资产。`;

  return {
    intent: "asset_extraction",
    riskLevel: "write",
    confirmationPolicy,
    scope,
    preflightSummary: buildPreflightSummary({ intent: "asset_extraction", scope, confirmationPolicy, message: preflightMessage }),
    executor: {
      name: "runNovelAssetExtractionFastPath",
      options: {
        sourceText: text,
      },
    },
    sourceText: text,
    signals: signal.signals,
  };
}

export function createWorkspaceCommandPlan(text: string, snapshot?: WorkspaceCommandSnapshot): WorkspaceCommandPlan | null {
  const sourceText = text.trim();
  if (!sourceText) return null;

  const signal = detectIntent(sourceText);
  if (!signal) return null;

  if (signal.intent === "asset_image_generation") return buildAssetImagePlan(sourceText, signal, snapshot);
  if (signal.intent === "storyboard_generation") return buildStoryboardPlan(sourceText, signal, snapshot);
  if (signal.intent === "storyboard_clear") return buildStoryboardClearPlan(sourceText, signal, snapshot);
  return buildAssetExtractionPlan(sourceText, signal, snapshot);
}
