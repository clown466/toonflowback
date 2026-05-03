import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

const ARTIFACT_MISSING_REASON = "产物文件缺失或无法访问";
const STORYBOARD_SUCCESS_STATE = "已完成";

function missingArtifactDiagnostic(filePath: string | null) {
  return {
    code: "ARTIFACT_MISSING",
    message: ARTIFACT_MISSING_REASON,
    filePath,
  };
}

async function normalizePollingStoryboardImage(item: any) {
  const rawFilePath = item.filePath || null;
  let state = item.state;
  let errorReason = item.errorReason ?? item.reason ?? null;
  let diagnostic = null;
  let src = null;

  if (state === STORYBOARD_SUCCESS_STATE) {
    const exists = rawFilePath ? await u.oss.fileExists(rawFilePath) : false;
    if (!exists) {
      state = "生成失败";
      errorReason = ARTIFACT_MISSING_REASON;
      diagnostic = missingArtifactDiagnostic(rawFilePath);
      await u
        .db("o_storyboard")
        .where({ id: item.id })
        .update({ state, reason: errorReason });
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
      .db("o_storyboard")
      .whereIn("id", ids)
      .whereNot("state", "生成中")
      .select("id", "state", "reason", "filePath", "prompt");
    const result = await Promise.all(data.map(normalizePollingStoryboardImage));
    res.status(200).send(success(result));
  },
);
