import type {
  WorkspaceAssetImageScope,
  WorkspaceAssetType,
  WorkspaceChapterScope,
  WorkspaceMissingInfo,
  WorkspaceProjectSnapshot,
  WorkspaceProjectSnapshotAsset,
  WorkspaceProjectSnapshotNovel,
  WorkspaceResolvedScope,
  WorkspaceScopeCandidate,
} from "@/agents/workspaceAgent/command/types";

const ASSET_TYPES: WorkspaceAssetType[] = ["role", "scene", "tool"];

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function compactText(value: string | null | undefined) {
  return String(value ?? "").replace(/\s+/g, "");
}

export function chineseNumberToArabic(value: string): number | null {
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

  let rest = text;
  let total = 0;
  const hundredIndex = rest.indexOf("百");
  if (hundredIndex >= 0) {
    const hundredText = rest.slice(0, hundredIndex);
    total += (hundredText ? digits[hundredText] ?? 0 : 1) * 100;
    rest = rest.slice(hundredIndex + 1);
  }

  const tenIndex = rest.indexOf("十");
  if (tenIndex >= 0) {
    const tenText = rest.slice(0, tenIndex);
    total += (tenText ? digits[tenText] ?? 0 : 1) * 10;
    const oneText = rest.slice(tenIndex + 1);
    total += oneText ? digits[oneText] ?? 0 : 0;
    return total > 0 ? total : null;
  }

  if (rest.length === 1 && digits[rest] != null) return total + digits[rest];
  return total > 0 ? total : null;
}

function normalizePositiveLimit(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = chineseNumberToArabic(value);
  if (!Number.isInteger(parsed) || parsed == null || parsed <= 0) return undefined;
  return Math.min(parsed, 100);
}

export function parseWorkspaceAssetType(text: string): WorkspaceAssetType | undefined {
  const matched: WorkspaceAssetType[] = [];
  if (/(角色|人物|主角|配角|character|role)/i.test(text)) matched.push("role");
  if (/(场景|环境|地点|空间|scene|environment|location)/i.test(text)) matched.push("scene");
  if (/(道具|物品|工具|prop|props|tool)/i.test(text)) matched.push("tool");
  return matched.length === 1 ? matched[0] : undefined;
}

export function parseWorkspaceLimit(text: string): number | undefined {
  const numberToken = String.raw`(\d{1,3}|[零〇一二两三四五六七八九十百]{1,8})`;
  const assetWords = String.raw`(?:角色|人物|场景|环境|地点|道具|物品|工具|资产|参考图|图片|图)`;
  const patterns = [
    new RegExp(String.raw`前\s*${numberToken}\s*(?:个|张|幅|组)?\s*${assetWords}`, "i"),
    new RegExp(String.raw`(?:生成|提交|出|生|做|重试|补)\s*前?\s*${numberToken}\s*(?:个|张|幅|组)?\s*${assetWords}`, "i"),
    new RegExp(String.raw`${numberToken}\s*(?:个|张|幅|组)\s*${assetWords}`, "i"),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const limit = normalizePositiveLimit(match?.[1]);
    if (limit) return limit;
  }
  return undefined;
}

function parseIncludeCompleted(text: string) {
  return /includeCompleted/i.test(text) || /(重新|重绘|重出|再生成|覆盖|替换|修改|改成|改为)/i.test(text) || /(包含|包括|连同|也要|一起).*(已完成|完成的|已有图|已经出图|出过图)/.test(text);
}

function parseOnlyFailed(text: string) {
  return /onlyFailed/i.test(text) || /(只|仅|专门|重新|重试|补).*(失败|报错|错误|未成功)/.test(text);
}

function parseAssetIds(text: string) {
  const ids = new Set<number>();
  const patterns = [
    /(?:asset|assets|资产)\s*(?:id|ID|#|编号)?\s*[:：#]?\s*(\d{1,10})/gi,
    /(?:id|ID)\s*[:：#]\s*(\d{1,10})/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const id = Number(match[1]);
      if (Number.isInteger(id) && id > 0) ids.add(id);
    }
  }
  return Array.from(ids);
}

function assetLabel(asset: WorkspaceProjectSnapshotAsset) {
  return `${asset.name ?? "未命名"}${asset.type ? ` (${asset.type})` : ""}`;
}

function findNamedAssets(text: string, snapshot: WorkspaceProjectSnapshot, assetType?: WorkspaceAssetType) {
  const normalizedText = normalizeText(text);
  return snapshot.assets.filter((asset) => {
    if (assetType && asset.type !== assetType) return false;
    const name = normalizeText(asset.name);
    return name.length >= 2 && normalizedText.includes(name);
  });
}

function resolveAssetImageScope(text: string, snapshot: WorkspaceProjectSnapshot): WorkspaceAssetImageScope {
  const assetType = parseWorkspaceAssetType(text);
  const matchedAssets = findNamedAssets(text, snapshot, assetType);
  const assetIds = new Set(parseAssetIds(text));
  const assetNames = new Set<string>();

  for (const asset of matchedAssets) {
    assetIds.add(asset.id);
    if (asset.name?.trim()) assetNames.add(asset.name.trim());
  }

  return {
    assetType,
    limit: parseWorkspaceLimit(text),
    assetIds: Array.from(assetIds),
    assetNames: Array.from(assetNames),
    includeCompleted: parseIncludeCompleted(text),
    onlyFailed: parseOnlyFailed(text),
  };
}

function novelLabel(novel: WorkspaceProjectSnapshotNovel) {
  const index = novel.chapterIndex == null ? "" : `项目内第${novel.chapterIndex}条`;
  return [index, novel.chapter].filter(Boolean).join(" ");
}

function candidateFromNovel(novel: WorkspaceProjectSnapshotNovel, score: number): WorkspaceScopeCandidate {
  return {
    id: novel.id,
    label: novelLabel(novel) || `novel:${novel.id}`,
    kind: "novel",
    score,
  };
}

function exactOrContainsChapterMatches(token: string, novels: WorkspaceProjectSnapshotNovel[]) {
  const compactToken = compactText(token).toLowerCase();
  if (!compactToken) return [];

  const exact = novels.filter((novel) => compactText(novel.chapter).toLowerCase() === compactToken);
  if (exact.length) return exact.map((novel) => candidateFromNovel(novel, 10));

  return novels
    .filter((novel) => {
      const chapter = compactText(novel.chapter).toLowerCase();
      return chapter.length > 0 && (chapter.includes(compactToken) || compactToken.includes(chapter));
    })
    .map((novel) => candidateFromNovel(novel, 6));
}

function parseChapterTokens(text: string) {
  const tokens = new Set<string>();
  const quotedPatterns = [
    /(?:原始名|章节名|chapter)\s*[:：]?\s*["“']([^"”'\n，。；]+)["”']?/gi,
    /(?:原始名|章节名)\s*[:：]?\s*([^\n，。；]+)/g,
  ];
  for (const pattern of quotedPatterns) {
    for (const match of text.matchAll(pattern)) {
      const token = match[1]?.trim();
      if (token) tokens.add(token);
    }
  }

  for (const match of text.matchAll(/\bjuben\s*\d+\b/gi)) {
    tokens.add(match[0].replace(/\s+/g, ""));
  }

  const numberToken = String.raw`(\d{1,4}|[零〇一二两三四五六七八九十百]{1,8})`;
  const chapterPattern = new RegExp(String.raw`第\s*${numberToken}\s*(?:章|回|节)`, "g");
  for (const match of text.matchAll(chapterPattern)) {
    if (match[0]) tokens.add(match[0].replace(/\s+/g, ""));
  }

  return Array.from(tokens);
}

function resolveChapterScope(text: string, snapshot: WorkspaceProjectSnapshot, missingInfo: WorkspaceMissingInfo[]): WorkspaceChapterScope {
  const tokens = parseChapterTokens(text);
  const selected = new Map<number, WorkspaceScopeCandidate>();
  const allCandidates = new Map<number, WorkspaceScopeCandidate>();

  for (const token of tokens) {
    const candidates = exactOrContainsChapterMatches(token, snapshot.novels);
    for (const candidate of candidates) allCandidates.set(candidate.id, candidate);

    if (candidates.length === 1) {
      selected.set(candidates[0]!.id, candidates[0]!);
    } else if (candidates.length > 1) {
      missingInfo.push({
        field: "chapter",
        reason: `章节线索“${token}”匹配到多条导入记录，需要确认具体章节。`,
        candidates,
      });
    } else if (/^juben\d+$/i.test(token)) {
      missingInfo.push({
        field: "chapter",
        reason: `章节线索“${token}”没有匹配任何原始章节名；不会把它直接等同为项目内第${token.replace(/\D+/g, "")}条。`,
        candidates: snapshot.novels.slice(0, 8).map((novel) => candidateFromNovel(novel, 1)),
      });
    } else {
      missingInfo.push({
        field: "chapter",
        reason: `章节线索“${token}”无法确认。`,
        candidates: snapshot.novels.slice(0, 8).map((novel) => candidateFromNovel(novel, 1)),
      });
    }
  }

  return {
    novelIds: Array.from(selected.keys()),
    tokens,
    candidates: Array.from(allCandidates.values()),
  };
}

function addAssetMissingInfo(scope: WorkspaceAssetImageScope, snapshot: WorkspaceProjectSnapshot, missingInfo: WorkspaceMissingInfo[]) {
  if (!scope.assetIds.length) return;
  const validIds = new Set(snapshot.assets.map((asset) => asset.id));
  const missingIds = scope.assetIds.filter((id) => !validIds.has(id));
  if (!missingIds.length) return;

  const candidates = snapshot.assets
    .filter((asset) => !scope.assetType || ASSET_TYPES.includes(scope.assetType) && asset.type === scope.assetType)
    .slice(0, 8)
    .map((asset) => ({
      id: asset.id,
      label: assetLabel(asset),
      kind: "asset" as const,
      score: 1,
    }));
  missingInfo.push({
    field: "assetIds",
    reason: `资产 ID 不存在或不属于当前项目：${missingIds.join(", ")}。`,
    candidates,
  });
}

export function resolveWorkspaceScope(text: string, snapshot: WorkspaceProjectSnapshot): WorkspaceResolvedScope {
  const missingInfo: WorkspaceMissingInfo[] = [];
  const assetImages = resolveAssetImageScope(text, snapshot);
  const chapters = resolveChapterScope(text, snapshot, missingInfo);
  addAssetMissingInfo(assetImages, snapshot, missingInfo);

  return {
    assetImages,
    chapters,
    missingInfo,
  };
}
