import type { ImageGenerationAssetType } from "@/services/imageGenerationSkill";

export type WorkspaceIntent =
  | "generate_asset_images"
  | "extract_novel_assets"
  | "generate_storyboards"
  | "clear_storyboards"
  | "delegate"
  | "unknown";

export type WorkspaceRiskLevel = "low" | "medium" | "high" | "destructive";

export type WorkspaceConfirmationPolicy = "none" | "recommended" | "required";

export type WorkspaceAssetType = ImageGenerationAssetType;

export interface WorkspaceCommandPlan {
  intent: WorkspaceIntent;
  riskLevel: WorkspaceRiskLevel;
  confirmationPolicy: WorkspaceConfirmationPolicy;
  scope?: WorkspaceResolvedScope;
  missingInfo?: WorkspaceMissingInfo[];
  summary?: string;
}

export interface WorkspaceMissingInfo {
  field: string;
  reason: string;
  candidates?: WorkspaceScopeCandidate[];
}

export interface WorkspaceScopeCandidate {
  id: number;
  label: string;
  kind: "asset" | "novel" | "script";
  score?: number;
}

export interface WorkspaceAssetImageScope {
  assetType?: WorkspaceAssetType;
  limit?: number;
  assetIds: number[];
  assetNames: string[];
  includeCompleted: boolean;
  onlyFailed: boolean;
}

export interface WorkspaceChapterScope {
  novelIds: number[];
  tokens: string[];
  candidates: WorkspaceScopeCandidate[];
}

export interface WorkspaceResolvedScope {
  assetImages: WorkspaceAssetImageScope;
  chapters: WorkspaceChapterScope;
  missingInfo: WorkspaceMissingInfo[];
}

export interface WorkspaceProjectSnapshot {
  project: WorkspaceProjectSnapshotProject | null;
  novels: WorkspaceProjectSnapshotNovel[];
  assets: WorkspaceProjectSnapshotAsset[];
  scripts: WorkspaceProjectSnapshotScript[];
  imageGenerationSkills: WorkspaceProjectSnapshotImageGenerationSkill[];
}

export interface WorkspaceProjectSnapshotProject {
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

export interface WorkspaceProjectSnapshotNovel {
  id: number;
  chapterIndex?: number | null;
  reel?: string | null;
  chapter?: string | null;
  chapterData?: string | null;
  eventState?: number | null;
  event?: string | null;
  errorReason?: string | null;
}

export interface WorkspaceProjectSnapshotAsset {
  id: number;
  name?: string | null;
  type?: string | null;
  describe?: string | null;
  prompt?: string | null;
  remark?: string | null;
  scriptId?: number | null;
  imageId?: number | null;
  promptState?: string | null;
  promptErrorReason?: string | null;
  image?: {
    id?: number | null;
    filePath?: string | null;
    state?: string | null;
    errorReason?: string | null;
    model?: string | null;
    resolution?: string | null;
  };
}

export interface WorkspaceProjectSnapshotScript {
  id: number;
  name?: string | null;
  content?: string | null;
  extractState?: number | null;
  createTime?: number | null;
  errorReason?: string | null;
}

export interface WorkspaceProjectSnapshotImageGenerationSkill {
  id: string;
  name: string;
  description: string;
  targetTypes: WorkspaceAssetType[];
  tags: string[];
  aspectRatio?: `${number}:${number}`;
  fileName: string;
}
