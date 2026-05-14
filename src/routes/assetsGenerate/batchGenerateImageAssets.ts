import express from "express";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { submitAssetImageGeneration } from "@/services/assetImageGeneration";
import u from "@/utils";

const router = express.Router();

const assetImageGenerationModeSchema = z.enum(["fresh_design", "reference_redraw", "partial_edit", "variant", "retry_failed", "ambiguous_redraw", "default"]);
const assetImageReferencePolicySchema = z.enum(["none", "current_asset", "auto"]);
const assetImagePromptPolicySchema = z.enum(["asset_description_plus_request", "asset_prompt_plus_request", "reuse_current_prompt"]);

const requestSchema = {
  projectId: z.number(),
  model: z.string(),
  resolution: z.string(),
  concurrentCount: z.number().int().min(1).optional(),
  skillId: z.string().optional().nullable(),
  generationMode: assetImageGenerationModeSchema.optional().nullable(),
  referencePolicy: assetImageReferencePolicySchema.optional().nullable(),
  promptPolicy: assetImagePromptPolicySchema.optional().nullable(),
  userRequirement: z.string().optional().nullable(),
  items: z.array(
    z.object({
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
      promptMode: z.enum(["source", "final"]).optional(),
    }),
  ),
};

export default router.post("/", validateFields(requestSchema), async (req, res) => {
  try {
    const { projectId, model, resolution, concurrentCount, skillId, generationMode, referencePolicy, promptPolicy, userRequirement, items } = req.body;
    const result = await submitAssetImageGeneration({ projectId, model, resolution, concurrentCount, skillId, generationMode, referencePolicy, promptPolicy, userRequirement, items });
    return res.status(200).send(success(result));
  } catch (err) {
    console.error("[batchGenerateImageAssets] request failed", u.error(err));
    return res.status(500).send(error(err instanceof Error ? err.message : String(err)));
  }
});
