import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

const ARTIFACT_MISSING_REASON = "产物文件缺失或无法访问";
const VIDEO_SUCCESS_STATE = "生成成功";

function missingArtifactDiagnostic(filePath: string | null) {
  return {
    code: "ARTIFACT_MISSING",
    message: ARTIFACT_MISSING_REASON,
    filePath,
  };
}

async function normalizePollingVideo(item: any) {
  const rawFilePath = item.filePath || null;
  let state = item.state;
  let errorReason = item.errorReason ?? null;
  let diagnostic = null;
  let src = "";

  if (state === VIDEO_SUCCESS_STATE) {
    const exists = rawFilePath ? await u.oss.fileExists(rawFilePath) : false;
    if (!exists) {
      state = "生成失败";
      errorReason = ARTIFACT_MISSING_REASON;
      diagnostic = missingArtifactDiagnostic(rawFilePath);
      await u
        .db("o_video")
        .where({ id: item.id })
        .update({ state, errorReason });
    } else {
      src = await u.oss.getFileUrl(rawFilePath);
    }
  } else if (rawFilePath) {
    src = await u.oss.getFileUrl(rawFilePath);
  }

  return {
    ...item,
    id: item.id,
    state: state === VIDEO_SUCCESS_STATE ? "已完成" : state,
    src,
    filePath: rawFilePath,
    errorReason,
    diagnostic,
  };
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
    videoIds: z.array(z.number()),
  }),
  async (req, res) => {
    const { videoIds } = req.body;
    const videoList = await u
      .db("o_video")
      .whereIn("id", videoIds)
      .whereIn("state", [VIDEO_SUCCESS_STATE, "生成失败"])
      .select("id", "state", "errorReason", "filePath");
    res.status(200).send(success(await Promise.all(videoList.map(normalizePollingVideo))));
  },
);
