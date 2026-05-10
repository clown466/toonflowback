import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

type IncomingNovelItem = {
  index: number;
  reel: string;
  chapter: string;
  chapterData: string;
  indexSource?: "filename" | "content" | "fallback";
};

function nextAvailableChapterIndex(existingIndexes: Set<number>, startAfter: number) {
  let next = Math.max(0, startAfter) + 1;
  while (existingIndexes.has(next)) next += 1;
  return next;
}

function isExplicitChapterIndex(item: IncomingNovelItem) {
  return item.indexSource !== "fallback";
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
        indexSource: z.enum(["filename", "content", "fallback"]).optional(),
      }),
    ),
  }),
  async (req, res) => {
    const { projectId, data } = req.body as { projectId: number; data: IncomingNovelItem[] };
    const totalNovelId = [];
    const getLastChapterIndex = await u.db("o_novel").where("projectId", projectId).select("chapterIndex").orderBy("chapterIndex", "desc").first();
    let lastChapterIndex = Number(getLastChapterIndex?.chapterIndex ?? 0);
    const existingRows = await u.db("o_novel").where("projectId", projectId).select("id", "chapterIndex");
    const existingByChapterIndex = new Map<number, { id: number; chapterIndex: number }>(
      existingRows
        .map((row: any) => ({ id: Number(row.id), chapterIndex: Number(row.chapterIndex) }))
        .filter((row) => Number.isFinite(row.id) && Number.isFinite(row.chapterIndex))
        .map((row) => [row.chapterIndex, row]),
    );
    const existingChapterIndexes = new Set(existingByChapterIndex.keys());

    const incomingExplicitIndexes = new Set<number>();
    for (const item of data) {
      const requestedIndex = Number(item.index);
      if (!Number.isFinite(requestedIndex) || requestedIndex <= 0 || !isExplicitChapterIndex(item)) continue;
      if (incomingExplicitIndexes.has(requestedIndex)) {
        return res.status(400).send({ message: `本次导入中第 ${requestedIndex} 章重复，请先取消重复项。` });
      }
      incomingExplicitIndexes.add(requestedIndex);
    }

    for (const item of data) {
      const requestedIndex = Number(item.index);
      const hasValidRequestedIndex = Number.isFinite(requestedIndex) && requestedIndex > 0;
      const explicitChapterIndex = hasValidRequestedIndex && isExplicitChapterIndex(item);
      const existing = hasValidRequestedIndex ? existingByChapterIndex.get(requestedIndex) : undefined;
      const chapterIndex = hasValidRequestedIndex && (explicitChapterIndex || !existing) ? requestedIndex : nextAvailableChapterIndex(existingChapterIndexes, lastChapterIndex);

      if (existing && explicitChapterIndex) {
        await u.db("o_novel").where({ id: existing.id, projectId }).update({
          chapterIndex,
          reel: item.reel,
          chapter: item.chapter,
          chapterData: item.chapterData,
          event: null,
          eventState: 0,
          errorReason: null,
        });
        totalNovelId.push(existing.id);
      } else {
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
        existingByChapterIndex.set(chapterIndex, { id: Number(id), chapterIndex });
      }

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
