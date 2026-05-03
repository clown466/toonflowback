import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

const ARTIFACT_MISSING_REASON = "产物文件缺失或无法访问";
const IMAGE_SUCCESS_STATE = "已完成";

function missingArtifactDiagnostic(filePath: string | null) {
  return {
    code: "ARTIFACT_MISSING",
    message: ARTIFACT_MISSING_REASON,
    filePath,
  };
}

async function normalizePollingAssetImage(item: any) {
  const rawFilePath = item.filePath || null;
  let state = item.state;
  let errorReason = item.errorReason ?? null;
  let diagnostic = null;
  let src = null;

  if (state === IMAGE_SUCCESS_STATE) {
    const exists = rawFilePath ? await u.oss.fileExists(rawFilePath) : false;
    if (!exists) {
      state = "生成失败";
      errorReason = ARTIFACT_MISSING_REASON;
      diagnostic = missingArtifactDiagnostic(rawFilePath);
      if (item.imageId) {
        await u
          .db("o_image")
          .where({ id: item.imageId })
          .update({ state, errorReason });
      }
    } else {
      src = await u.oss.getSmallImageUrl(rawFilePath);
    }
  } else if (rawFilePath) {
    src = await u.oss.getSmallImageUrl(rawFilePath);
  }

  return {
    ...item,
    id: item.id,
    state,
    src,
    filePath: rawFilePath,
    errorReason,
    diagnostic,
  };
}

export default router.post(
  "/",
  validateFields({
    ids: z.array(z.number()),
  }),
  async (req, res) => {
    const { ids } = req.body;
    const data = await u
      .db("o_assets")
      .leftJoin("o_image", "o_assets.imageId", "o_image.id")
      .whereIn("o_assets.id", ids)
      .whereNot("o_image.state", "生成中")
      .select("o_image.id as imageId", "o_image.state", "o_assets.id", "o_image.filePath", "o_image.errorReason", "o_assets.prompt");
    const result = await Promise.all(data.map(normalizePollingAssetImage));
    res.status(200).send(success(result));
  },
);
