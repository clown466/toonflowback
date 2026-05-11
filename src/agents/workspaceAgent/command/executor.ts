import {
  ProjectAssetImageGenerationOptions,
  ToolConfig,
  runNovelAssetExtractionFastPath,
  runProjectAssetImageGenerationFastPath,
  runProjectStoryboardClearFastPath,
  runProjectStoryboardDraftFastPath,
} from "@/agents/workspaceAgent/tools";
import { assetImageGenerationModeLabel, type AssetImageGenerationMode, type AssetImagePromptPolicy, type AssetImageReferencePolicy } from "@/services/assetImageIntent";

export type WorkspaceCommandIntent = "asset_image_generation" | "storyboard_generation" | "storyboard_clear" | "asset_extraction";

export type WorkspaceCommandConfirmationPolicy = "auto" | "confirm" | "require_confirmation" | "skip" | string;

type AssetImageScope = Pick<
  ProjectAssetImageGenerationOptions,
  "assetType" | "limit" | "assetIds" | "assetNames" | "includeCompleted" | "skillId" | "generationMode" | "referencePolicy" | "promptPolicy" | "useExistingAssetReference"
>;

export interface WorkspaceCommandScope extends AssetImageScope {
  force?: boolean;
  append?: boolean;
  chapterIds?: number[];
  chapterIndexes?: number[];
  skillId?: string;
}

export interface WorkspaceCommandPlan {
  intent: WorkspaceCommandIntent | string;
  scope?: WorkspaceCommandScope;
  sourceText?: string;
  userRequirement?: string;
  confirmationPolicy?: WorkspaceCommandConfirmationPolicy;
  preflightSummary?: WorkspaceCommandPreflightSummary;
}

export interface WorkspaceCommandPreflightSummary {
  intent: WorkspaceCommandIntent | string;
  scopeText: string;
  quantityText: string;
  includeCompleted: boolean;
  redraw: boolean;
  generationMode?: AssetImageGenerationMode;
  referencePolicy?: AssetImageReferencePolicy;
  confirmationPolicy: WorkspaceCommandConfirmationPolicy;
  message: string;
}

export interface WorkspaceCommandExecutionResult {
  handled: boolean;
  message: string;
  result?: unknown;
}

function uniquePositiveIntegers(values?: number[]) {
  return Array.from(new Set((values ?? []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)));
}

function uniqueNonEmptyStrings(values?: string[]) {
  return Array.from(new Set((values ?? []).map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function normalizeLimit(value: unknown) {
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue <= 0) return undefined;
  return Math.min(numberValue, 100);
}

function normalizeAssetImageScope(scope?: WorkspaceCommandScope): AssetImageScope {
  return {
    assetType: scope?.assetType,
    limit: normalizeLimit(scope?.limit),
    assetIds: uniquePositiveIntegers(scope?.assetIds),
    assetNames: uniqueNonEmptyStrings(scope?.assetNames),
    includeCompleted: Boolean(scope?.includeCompleted),
    skillId: typeof scope?.skillId === "string" && scope.skillId.trim() ? scope.skillId.trim() : undefined,
    generationMode: scope?.generationMode,
    referencePolicy: scope?.referencePolicy,
    promptPolicy: scope?.promptPolicy,
    useExistingAssetReference: typeof scope?.useExistingAssetReference === "boolean" ? scope.useExistingAssetReference : undefined,
  };
}

function assetTypeLabel(type?: AssetImageScope["assetType"]) {
  if (type === "role") return "角色";
  if (type === "scene") return "场景";
  if (type === "tool") return "道具";
  return "角色/场景/道具资产";
}

function buildAssetScopeText(scope: AssetImageScope) {
  const parts: string[] = [assetTypeLabel(scope.assetType)];
  if (scope.limit) parts.push(`前 ${scope.limit} 个`);
  if (scope.assetIds?.length) parts.push(`指定 ID ${scope.assetIds.join(", ")}`);
  if (scope.assetNames?.length) parts.push(`指定名称 ${scope.assetNames.join("、")}`);
  return parts.join("，");
}

function buildPreflightSummary(plan: WorkspaceCommandPlan): WorkspaceCommandPreflightSummary {
  const confirmationPolicy = plan.confirmationPolicy ?? "auto";

  if (plan.intent === "asset_image_generation") {
    const scope = normalizeAssetImageScope(plan.scope);
    const explicitCount = scope.assetIds?.length || scope.assetNames?.length || scope.limit;
    const quantityText = explicitCount ? `最多/指定 ${explicitCount} 个` : "范围内所有未完成资产";
    const referenceText =
      scope.referencePolicy === "none" || scope.useExistingAssetReference === false
        ? "不带入当前资产图参考"
        : scope.referencePolicy === "current_asset" || scope.useExistingAssetReference === true
          ? "带入当前资产图参考"
          : "按指令判断是否带参考图";
    const modeText = scope.generationMode ? `；模式：${assetImageGenerationModeLabel(scope.generationMode)}` : "";
    const message = `预检：提交${buildAssetScopeText(scope)}出图；数量：${quantityText}；${scope.includeCompleted ? "包含已完成资产，允许重绘" : "不包含已完成资产，不重绘"}；${referenceText}${modeText}`;
    return {
      intent: plan.intent,
      scopeText: buildAssetScopeText(scope),
      quantityText,
      includeCompleted: Boolean(scope.includeCompleted),
      redraw: Boolean(scope.includeCompleted),
      generationMode: scope.generationMode,
      referencePolicy: scope.referencePolicy,
      confirmationPolicy,
      message,
    };
  }

  if (plan.intent === "storyboard_generation") {
    const appendText = plan.scope?.append ? "追加写入" : plan.scope?.force ? "清空旧分镜并重新写入" : "必要时替换/复用章节分镜工作区";
    const forceText = plan.scope?.force ? "强制重新生成" : "不强制重建已存在分镜";
    return {
      intent: plan.intent,
      scopeText: "当前项目章节分镜草案",
      quantityText: "由小说章节匹配结果决定",
      includeCompleted: false,
      redraw: Boolean(plan.scope?.force),
      confirmationPolicy,
      message: `预检：生成当前项目章节分镜草案；范围：${appendText}；数量：由项目数据决定；${forceText}`,
    };
  }

  if (plan.intent === "storyboard_clear") {
    return {
      intent: plan.intent,
      scopeText: "当前项目章节分镜",
      quantityText: "由当前章节分镜数量决定",
      includeCompleted: false,
      redraw: false,
      confirmationPolicy,
      message: "预检：清空当前项目章节分镜；数量：由当前章节分镜数量决定；不涉及重绘",
    };
  }

  if (plan.intent === "asset_extraction") {
    return {
      intent: plan.intent,
      scopeText: "当前项目小说章节",
      quantityText: "由当前小说章节数量决定",
      includeCompleted: false,
      redraw: false,
      confirmationPolicy,
      message: "预检：从当前项目小说章节提取资产；数量：由规则提取结果决定；不涉及重绘",
    };
  }

  return {
    intent: plan.intent,
    scopeText: "未知范围",
    quantityText: "未知数量",
    includeCompleted: false,
    redraw: false,
    confirmationPolicy,
    message: `预检：未支持的 workspace command intent：${plan.intent}`,
  };
}

function pickMessage(fastPathResult: unknown, fallback: string) {
  if (typeof fastPathResult !== "object" || fastPathResult === null) return fallback;
  const result = fastPathResult as { message?: unknown; result?: { message?: unknown } };
  if (typeof result.message === "string" && result.message.trim()) return result.message;
  if (typeof result.result?.message === "string" && result.result.message.trim()) return result.result.message;
  return fallback;
}

function wrapExecution(preflightSummary: WorkspaceCommandPreflightSummary, fastPathResult: unknown): WorkspaceCommandExecutionResult {
  const handled = typeof fastPathResult === "object" && fastPathResult !== null && "handled" in fastPathResult ? Boolean((fastPathResult as { handled?: unknown }).handled) : true;
  return {
    handled,
    message: pickMessage(fastPathResult, preflightSummary.message),
    result: {
      preflightSummary,
      execution: fastPathResult,
    },
  };
}

export async function executeWorkspaceCommandPlan(config: ToolConfig, plan: WorkspaceCommandPlan): Promise<WorkspaceCommandExecutionResult> {
  const preflightSummary = plan.preflightSummary ?? buildPreflightSummary(plan);
  const sourceText = plan.sourceText ?? plan.userRequirement;

  if (plan.intent === "asset_image_generation") {
    const scope = normalizeAssetImageScope(plan.scope);
    if (plan.confirmationPolicy === "missingInfo" || plan.confirmationPolicy === "confirm") {
      return {
        handled: true,
        message: preflightSummary.message,
        result: {
          preflightSummary,
          needsConfirmation: true,
          reason: plan.confirmationPolicy,
        },
      };
    }
    return wrapExecution(
      preflightSummary,
      await runProjectAssetImageGenerationFastPath(config, {
        ...scope,
        sourceText,
        userRequirement: plan.userRequirement ?? plan.sourceText,
        disableNaturalLanguageScopeParsing: true,
      }),
    );
  }

  if (plan.intent === "storyboard_generation") {
    return wrapExecution(
      preflightSummary,
      await runProjectStoryboardDraftFastPath(config, {
        sourceText,
        force: plan.scope?.force,
        append: plan.scope?.append,
        novelIds: plan.scope?.chapterIds,
        chapterIndexes: plan.scope?.chapterIndexes,
        skillId: plan.scope?.skillId,
        userRequirement: plan.userRequirement ?? plan.sourceText,
      }),
    );
  }

  if (plan.intent === "storyboard_clear") {
    return wrapExecution(preflightSummary, await runProjectStoryboardClearFastPath(config, { sourceText }));
  }

  if (plan.intent === "asset_extraction") {
    return wrapExecution(
      preflightSummary,
      await runNovelAssetExtractionFastPath(config, {
        sourceText,
        novelIds: plan.scope?.chapterIds,
        chapterIndexes: plan.scope?.chapterIndexes,
      }),
    );
  }

  return {
    handled: false,
    message: `未支持的 workspace command intent：${plan.intent}`,
    result: {
      preflightSummary,
      reason: "unsupported_intent",
      intent: plan.intent,
    },
  };
}
