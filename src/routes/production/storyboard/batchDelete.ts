import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    ids: z.array(z.number()),
    projectId: z.number(),
  }),
  async (req, res) => {
    const { ids, projectId } = req.body;
    const storyboardIds = Array.from(new Set<number>(ids));

    if (!storyboardIds.length) return res.status(400).send(error("请先选择分镜"));

    const storyboardDataList = await u
      .db("o_storyboard")
      .whereIn("id", storyboardIds)
      .select("id", "projectId", "trackId", "flowId");

    if (storyboardDataList.length !== storyboardIds.length || storyboardDataList.some((item) => item.projectId !== projectId)) {
      return res.status(400).send(error("当前选择分镜不存在或不属于当前项目"));
    }

    const flowIds = Array.from(new Set(storyboardDataList.map((item) => item.flowId).filter((id): id is number => id != null)));
    const trackIds = Array.from(new Set(storyboardDataList.map((item) => item.trackId).filter((id): id is number => id != null)));

    await u.db.transaction(async (trx) => {
      await trx("o_assets2Storyboard").whereIn("storyboardId", storyboardIds).delete();
      if (flowIds.length) await trx("o_imageFlow").whereIn("id", flowIds).delete();
      await trx("o_storyboard").whereIn("id", storyboardIds).where("projectId", projectId).delete();

      for (const trackId of trackIds) {
        const storyboardCountRow = await trx("o_storyboard").where({ trackId, projectId }).count({ count: "id" }).first();
        const videoCountRow = await trx("o_video").where({ videoTrackId: trackId, projectId }).count({ count: "id" }).first();
        const storyboardCount = Number(storyboardCountRow?.count ?? 0);
        const videoCount = Number(videoCountRow?.count ?? 0);

        if (storyboardCount === 0 && videoCount === 0) {
          await trx("o_videoTrack").where({ id: trackId, projectId }).delete();
        }
      }
    });

    res.status(200).send(success({ message: "视频删除成功" }));
  },
);
