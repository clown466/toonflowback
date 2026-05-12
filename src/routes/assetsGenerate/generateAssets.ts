import express from "express";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { submitAssetImageGeneration } from "@/services/assetImageGeneration";
import u from "@/utils";

const router = express.Router();

type AssetType = "role" | "scene" | "tool";

const assetImageGenerationModeSchema = z.enum(["fresh_design", "reference_redraw", "partial_edit", "variant", "retry_failed", "ambiguous_redraw", "default"]);
const assetImageReferencePolicySchema = z.enum(["none", "current_asset", "auto"]);
const assetImagePromptPolicySchema = z.enum(["asset_description_plus_request", "asset_prompt_plus_request", "reuse_current_prompt"]);

// ─── 生成资产图片 ────────────────────────────────────────────

const requestSchema = {
  projectId: z.number(),
  model: z.string(),
  resolution: z.string(),
  id: z.number(),
  type: z.enum(["role", "scene", "tool", "storyboard"]),
  name: z.string(),
  prompt: z.string(),
  describe: z.string().optional().nullable(),
  base64: z.string().optional().nullable(),
  skillId: z.string().optional().nullable(),
  generationMode: assetImageGenerationModeSchema.optional().nullable(),
  referencePolicy: assetImageReferencePolicySchema.optional().nullable(),
  promptPolicy: assetImagePromptPolicySchema.optional().nullable(),
  userRequirement: z.string().optional().nullable(),
};

export default router.post("/", validateFields(requestSchema), async (req, res) => {
  try {
    const { projectId, model, resolution, id, type, name, prompt, describe, base64, skillId, generationMode, referencePolicy, promptPolicy, userRequirement } = req.body;
    if (!["role", "scene", "tool"].includes(type)) return res.status(400).send(error("不支持的类型"));
    const currentAsset = await u
      .db("o_assets")
      .leftJoin("o_image", "o_assets.imageId", "o_image.id")
      .where("o_assets.id", id)
      .select("o_assets.imageId", "o_image.filePath as imageFilePath")
      .first();
    const effectiveBase64 =
      base64 ||
      (referencePolicy === "current_asset" && currentAsset?.imageFilePath
        ? await u.oss.getImageBase64(currentAsset.imageFilePath).catch(() => "")
        : "");
    if (referencePolicy === "current_asset" && !effectiveBase64) {
      return res.status(400).send(error("当前资产没有可用参考图，无法按原图修改"));
    }
    await u.db("o_assets").where("id", id).update({ prompt });

    const result = await submitAssetImageGeneration({
      projectId,
      model,
      resolution,
      concurrentCount: 1,
      skillId,
      generationMode,
      referencePolicy,
      promptPolicy,
      userRequirement,
      items: [
        {
          id,
          type: type as AssetType,
          name,
          prompt,
          describe,
          base64: effectiveBase64,
          skillId,
          generationMode,
          referencePolicy,
          promptPolicy,
          userRequirement,
        },
      ],
    });

    return res.status(200).send(success({ ...result, assetsId: id, imageId: result.imageIds[0]?.imageId ?? null }));
  } catch (e: any) {
    return res.status(400).send(error(e.message || "图片生成失败"));
  }
});
