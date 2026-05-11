export type AssetImageGenerationMode = "fresh_design" | "reference_redraw" | "partial_edit" | "variant" | "retry_failed" | "ambiguous_redraw" | "default";
export type AssetImageReferencePolicy = "none" | "current_asset" | "auto";
export type AssetImagePromptPolicy = "asset_description_plus_request" | "asset_prompt_plus_request" | "reuse_current_prompt";

export interface AssetImageIntentDecision {
  generationMode: AssetImageGenerationMode;
  referencePolicy: AssetImageReferencePolicy;
  promptPolicy: AssetImagePromptPolicy;
  includeCompleted: boolean;
  useExistingAssetReference?: boolean;
  needsClarification: boolean;
  clarificationQuestion?: string;
  confidence: number;
  reason: string;
}

export interface AssetImageIntentOverrides {
  generationMode?: AssetImageGenerationMode | null;
  referencePolicy?: AssetImageReferencePolicy | null;
  promptPolicy?: AssetImagePromptPolicy | null;
  includeCompleted?: boolean | null;
  useExistingAssetReference?: boolean | null;
}

function has(pattern: RegExp, text: string) {
  return pattern.test(text);
}

function isFreshMode(mode?: AssetImageGenerationMode | null) {
  return mode === "fresh_design";
}

function isReferenceMode(mode?: AssetImageGenerationMode | null) {
  return mode === "reference_redraw" || mode === "partial_edit" || mode === "variant";
}

function normalizeText(text?: string | null) {
  return String(text ?? "").trim();
}

function defaultPromptPolicyFor(referencePolicy: AssetImageReferencePolicy): AssetImagePromptPolicy {
  return referencePolicy === "none" ? "asset_description_plus_request" : "asset_prompt_plus_request";
}

function buildDecision(input: {
  generationMode: AssetImageGenerationMode;
  referencePolicy: AssetImageReferencePolicy;
  promptPolicy?: AssetImagePromptPolicy | null;
  includeCompleted: boolean;
  needsClarification?: boolean;
  clarificationQuestion?: string;
  confidence: number;
  reason: string;
}): AssetImageIntentDecision {
  const promptPolicy = input.promptPolicy ?? defaultPromptPolicyFor(input.referencePolicy);
  return {
    ...input,
    promptPolicy,
    useExistingAssetReference: input.referencePolicy === "current_asset" ? true : input.referencePolicy === "none" ? false : undefined,
    needsClarification: Boolean(input.needsClarification),
  };
}

export function decideAssetImageIntent(text?: string | null, overrides: AssetImageIntentOverrides = {}): AssetImageIntentDecision {
  const source = normalizeText(text);
  const explicitNoReference =
    has(/(不|不要|别|无需|禁止|完全不).{0,10}(参考|使用|沿用|继承|带入).{0,10}(原图|旧图|当前图|现有图|已有图|参考图|图片)/i, source) ||
    has(/(原图|旧图|当前图|现有图|已有图|参考图|图片).{0,10}(不|不要|别|无需|禁止|完全不).{0,10}(参考|使用|沿用|继承|带入)/i, source);
  const explicitFresh =
    explicitNoReference ||
    has(/(全新|重新设计|从零设计|新形象|新造型|只按文字|纯文本).{0,64}(生成|出图|生图|设计|重绘|角色图|资产图|参考图|图片|图像|形象)/i, source) ||
    has(/(重新生成|重生|重出|再生成|再出).{0,64}(全新|新的|新版本|新形象|新造型)/i, source) ||
    has(/(角色图|资产图|参考图|图片|图像|形象).{0,64}(全新|重新设计|从零设计|新形象|新造型|只按文字|纯文本)/i, source);
  const explicitReference = has(/(参考|基于|沿用|保持|保留).{0,16}(现有|当前|原有|已有|原图|旧图|当前图|现有图|已有图|参考图)/i, source);
  const partialEdit = has(/(修改|改成|改为|替换|局部|只改|调整|修正|换成|变成)/i, source);
  const variant = has(/(变体|变种|另一个版本|多个版本|多来几张|再来一张|相似但不同)/i, source);
  const retryFailed = has(/(重试|重新跑|补跑|只|仅|专门).{0,16}(失败|报错|错误|未成功)/i, source);
  const regenerate = has(/(重新生成|重生|重出|再生成|再出|重新出)/i, source);
  const broadBatchRedraw = has(/(全部|所有|全量|整个项目|批量)/i, source);
  const ambiguousRedraw = has(/(重绘|重新画)/i, source) && !explicitFresh && !explicitReference && !partialEdit && !variant && !retryFailed && !broadBatchRedraw;
  const inferredIncludeCompleted =
    retryFailed ||
    explicitFresh ||
    explicitReference ||
    partialEdit ||
    variant ||
    regenerate ||
    ambiguousRedraw ||
    has(/全部|所有|全量|覆盖|已完成.*也|包括.*已完成/i, source);
  const includeCompleted = overrides.includeCompleted ?? inferredIncludeCompleted;

  if (overrides.generationMode || overrides.referencePolicy || typeof overrides.useExistingAssetReference === "boolean") {
    const referencePolicy =
      overrides.referencePolicy ??
      (typeof overrides.useExistingAssetReference === "boolean" ? (overrides.useExistingAssetReference ? "current_asset" : "none") : isFreshMode(overrides.generationMode) ? "none" : isReferenceMode(overrides.generationMode) ? "current_asset" : "auto");
    const generationMode = overrides.generationMode ?? (referencePolicy === "none" ? "fresh_design" : referencePolicy === "current_asset" ? "reference_redraw" : "default");
    return buildDecision({
      generationMode,
      referencePolicy,
      promptPolicy: overrides.promptPolicy,
      includeCompleted,
      needsClarification: generationMode === "ambiguous_redraw",
      clarificationQuestion: generationMode === "ambiguous_redraw" ? "你是要参考当前图修改，还是完全重新设计一张？" : undefined,
      confidence: 1,
      reason: "structured_override",
    });
  }

  if (explicitFresh) {
    return buildDecision({
      generationMode: "fresh_design",
      referencePolicy: "none",
      promptPolicy: "asset_description_plus_request",
      includeCompleted,
      confidence: 0.95,
      reason: explicitNoReference ? "explicit_no_reference" : "fresh_design_language",
    });
  }

  if (variant) {
    return buildDecision({
      generationMode: "variant",
      referencePolicy: "current_asset",
      promptPolicy: "asset_prompt_plus_request",
      includeCompleted,
      confidence: 0.84,
      reason: "variant_language",
    });
  }

  if (explicitReference) {
    return buildDecision({
      generationMode: partialEdit ? "partial_edit" : "reference_redraw",
      referencePolicy: "current_asset",
      promptPolicy: "asset_prompt_plus_request",
      includeCompleted,
      confidence: 0.9,
      reason: "explicit_reference",
    });
  }

  if (partialEdit) {
    return buildDecision({
      generationMode: "ambiguous_redraw",
      referencePolicy: "auto",
      promptPolicy: "asset_description_plus_request",
      includeCompleted,
      needsClarification: true,
      clarificationQuestion: "你是要参考当前图修改，还是只按文字设定重新生成？",
      confidence: 0.42,
      reason: "edit_language_without_reference_policy",
    });
  }

  if (retryFailed) {
    return buildDecision({
      generationMode: "retry_failed",
      referencePolicy: "auto",
      promptPolicy: "reuse_current_prompt",
      includeCompleted: true,
      confidence: 0.86,
      reason: "retry_failed_language",
    });
  }

  if (ambiguousRedraw) {
    return buildDecision({
      generationMode: "ambiguous_redraw",
      referencePolicy: "auto",
      promptPolicy: "asset_prompt_plus_request",
      includeCompleted,
      needsClarification: true,
      clarificationQuestion: "你是要参考当前图修改，还是完全重新设计一张？",
      confidence: 0.45,
      reason: "ambiguous_redraw_language",
    });
  }

  if (regenerate) {
    return buildDecision({
      generationMode: "fresh_design",
      referencePolicy: "none",
      promptPolicy: "asset_description_plus_request",
      includeCompleted,
      confidence: 0.72,
      reason: "regenerate_defaults_to_fresh_design",
    });
  }

  return buildDecision({
    generationMode: "default",
    referencePolicy: "auto",
    promptPolicy: "asset_prompt_plus_request",
    includeCompleted,
    confidence: 0.5,
    reason: "default_asset_image_intent",
  });
}

export function assetImageGenerationModeLabel(mode: AssetImageGenerationMode) {
  if (mode === "fresh_design") return "全新设计";
  if (mode === "reference_redraw") return "参考重绘";
  if (mode === "partial_edit") return "局部修改";
  if (mode === "variant") return "变体生成";
  if (mode === "retry_failed") return "重试失败任务";
  if (mode === "ambiguous_redraw") return "重绘待确认";
  return "默认生成";
}
