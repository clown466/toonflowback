import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

function nextAvailableChapterIndex(existingIndexes: Set<number>, startAfter: number) {
  let next = Math.max(0, startAfter) + 1;
  while (existingIndexes.has(next)) next += 1;
  return next;
}

// 新增原文数据
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    data: z.array(
      z.object({
        index: z.number(),
        reel: z.string(),
        chapter: z.string(),
        chapterData: z.string(),
      }),
    ),
  }),
  async (req, res) => {
    const { projectId, data } = req.body;
    const totalNovelId = [];
    const getLastChapterIndex = await u.db("o_novel").where("projectId", projectId).select("chapterIndex").orderBy("chapterIndex", "desc").first();
    let lastChapterIndex = Number(getLastChapterIndex?.chapterIndex ?? 0);
    const existingChapterIndexes = new Set(
      (await u.db("o_novel").where("projectId", projectId).select("chapterIndex")).map((row: any) => Number(row.chapterIndex)).filter(Number.isFinite),
    );

    for (const item of data) {
      const requestedIndex = Number(item.index);
      const chapterIndex =
        Number.isFinite(requestedIndex) && requestedIndex > 0 && !existingChapterIndexes.has(requestedIndex)
          ? requestedIndex
          : nextAvailableChapterIndex(existingChapterIndexes, lastChapterIndex);
      const [id] = await u.db("o_novel").insert({
        projectId,
        chapterIndex,
        reel: item.reel,
        chapter: item.chapter,
        chapterData: item.chapterData,
        createTime: Date.now(),
        eventState: 0,
      });
      totalNovelId.push(id);
      lastChapterIndex = Math.max(lastChapterIndex, chapterIndex);
      existingChapterIndexes.add(chapterIndex);
    }
    const chapterAllList = await u.db("o_novel").where("projectId", projectId).whereIn("id", totalNovelId);
    const novelClass = new u.cleanNovel();
    novelClass.emitter.on("item", async (item) => {
      await u
        .db("o_novel")
        .where("id", item.id)
        .update({ event: item.event, eventState: item.event ? 1 : -1, errorReason: item?.errReason ?? null });
    });
    void novelClass.start(chapterAllList, projectId).catch((error) => {
      console.error("[addNovel] 事件分析后台任务失败:", u.error(error).message);
    });

    res.status(200).send(success({ message: "新增原文成功" }));
  },
);
