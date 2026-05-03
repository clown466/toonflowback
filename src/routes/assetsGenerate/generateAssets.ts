import express from "express";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { submitAssetImageGeneration } from "@/services/assetImageGeneration";

const router = express.Router();

type AssetType = "role" | "scene" | "tool";

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
  userRequirement: z.string().optional().nullable(),
};

export default router.post("/", validateFields(requestSchema), async (req, res) => {
  try {
    const { projectId, model, resolution, id, type, name, prompt, describe, base64, skillId, userRequirement } = req.body;
    if (!["role", "scene", "tool"].includes(type)) return res.status(400).send(error("不支持的类型"));

    const result = await submitAssetImageGeneration({
      projectId,
      model,
      resolution,
      concurrentCount: 1,
      skillId,
      userRequirement,
      items: [
        {
          id,
          type: type as AssetType,
          name,
          prompt,
          describe,
          base64,
          skillId,
          userRequirement,
        },
      ],
    });

    return res.status(200).send(success({ ...result, assetsId: id, imageId: result.imageIds[0]?.imageId ?? null }));
  } catch (e: any) {
    return res.status(400).send(error(e.message || "图片生成失败"));
  }
});
