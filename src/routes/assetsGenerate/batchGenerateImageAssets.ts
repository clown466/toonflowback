import express from "express";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { submitAssetImageGeneration } from "@/services/assetImageGeneration";

const router = express.Router();

const requestSchema = {
  projectId: z.number(),
  model: z.string(),
  resolution: z.string(),
  concurrentCount: z.number().int().min(1).optional(),
  skillId: z.string().optional().nullable(),
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
      userRequirement: z.string().optional().nullable(),
    }),
  ),
};

export default router.post("/", validateFields(requestSchema), async (req, res) => {
  try {
    const { projectId, model, resolution, concurrentCount, skillId, userRequirement, items } = req.body;
    const result = await submitAssetImageGeneration({ projectId, model, resolution, concurrentCount, skillId, userRequirement, items });
    return res.status(200).send(success(result));
  } catch (err) {
    console.error("[batchGenerateImageAssets] request failed", err);
    return res.status(500).send(error(err instanceof Error ? err.message : String(err)));
  }
});
