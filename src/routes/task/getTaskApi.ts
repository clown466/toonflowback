import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { z } from "zod";
const router = express.Router();

type TaskRow = Record<string, any>;

function parseRelatedObjects(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, any>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toNumberArray(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number).filter((item) => Number.isFinite(item));
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(Number).filter((item) => Number.isFinite(item)) : [];
  } catch {
    return [];
  }
}

async function toPreviewImage(row: any, source: string) {
  const filePath = row?.filePath;
  if (!filePath) return null;
  return {
    id: Number(row.id),
    source,
    name: row.name ?? row.title ?? source,
    filePath,
    originalSrc: await u.oss.getFileUrl(filePath),
    src: await u.oss.getSmallImageUrl(filePath),
  };
}

async function getAssetTaskPreviews(related: Record<string, any>) {
  const imageId = Number(related.imageId);
  const assetId = Number(related.assetId ?? related.id);
  let rows: any[] = [];

  if (Number.isFinite(imageId) && imageId > 0) {
    rows = await u.db("o_image").where({ id: imageId, state: "已完成" }).whereNotNull("filePath").select("id", "filePath", "type").limit(1);
  }
  if (!rows.length && Number.isFinite(assetId) && assetId > 0) {
    rows = await u
      .db("o_image")
      .where({ assetsId: assetId, state: "已完成" })
      .whereNotNull("filePath")
      .select("id", "filePath", "type")
      .orderBy("id", "desc")
      .limit(4);
  }
  const previews = await Promise.all(rows.map((row) => toPreviewImage(row, "asset")));
  return previews.filter(Boolean);
}

async function getStoryboardTaskPreviews(related: Record<string, any>) {
  const storyboardIds = [
    ...toNumberArray(related.storyboardIds),
    Number(related.storyboardId),
    Number(related.id && related.type === "storyboard" ? related.id : undefined),
  ].filter((id, index, arr) => Number.isFinite(id) && id > 0 && arr.indexOf(id) === index);
  if (!storyboardIds.length) return [];
  const rows = await u
    .db("o_storyboard")
    .whereIn("id", storyboardIds)
    .where("state", "已完成")
    .whereNotNull("filePath")
    .select("id", "filePath", "index")
    .orderBy("index", "asc")
    .limit(6);
  const previews = await Promise.all(rows.map((row) => toPreviewImage({ ...row, name: `分镜 ${Number(row.index ?? 0) + 1}` }, "storyboard")));
  return previews.filter(Boolean);
}

async function getDirectorBoardTaskPreviews(related: Record<string, any>) {
  const boardId = Number(related.directorBoardId ?? related.boardId);
  const storyboardIds = toNumberArray(related.storyboardIds);
  let query = u.db("o_directorBoard").where("state", "已完成").whereNotNull("filePath");
  if (Number.isFinite(boardId) && boardId > 0) {
    query = query.where("id", boardId);
  } else {
    const projectId = Number(related.projectId);
    const scriptId = Number(related.scriptId);
    if (!Number.isFinite(projectId) || !Number.isFinite(scriptId)) return [];
    query = query.where({ projectId, scriptId });
    if (storyboardIds.length) query = query.where("storyboardIds", JSON.stringify(storyboardIds));
  }
  const rows = await query.select("id", "name", "filePath", "updateTime").orderBy("updateTime", "desc").limit(4);
  const previews = await Promise.all(rows.map((row) => toPreviewImage(row, "directorBoard")));
  return previews.filter(Boolean);
}

async function getTaskPreviewImages(task: TaskRow) {
  if (task.state !== "已完成") return [];
  const related = parseRelatedObjects(task.relatedObjects);
  const taskClass = String(task.taskClass ?? "");
  if (/章节导演板/.test(taskClass)) return getDirectorBoardTaskPreviews(related);
  if (/分镜图片/.test(taskClass)) return getStoryboardTaskPreviews(related);
  if (/角色图|场景图|道具图|资产图片|生成图片/.test(taskClass)) return getAssetTaskPreviews(related);
  return [];
}

async function enrichTasks(data: TaskRow[]) {
  return Promise.all(
    data.map(async (item) => ({
      ...item,
      previewImages: await getTaskPreviewImages(item),
    })),
  );
}

export default router.post(
  "/",
  validateFields({
    state: z.string().optional().nullable(),
    taskClass: z.string().optional().nullable(),
    projectId: z.number().optional().nullable(),
    page: z.number(),
    limit: z.number(),
  }),
  async (req, res) => {
    const { taskClass, state, projectId, page = 1, limit = 10 }: any = req.body;
    const offset = (page - 1) * limit;
    const data = await u
      .db("o_tasks")
      .leftJoin("o_project", "o_project.id", "o_tasks.projectId")
      .andWhere((qb) => {
        if (taskClass) {
          qb.andWhere("o_tasks.taskClass", taskClass);
        }
        if (state) {
          qb.andWhere("o_tasks.state", state);
        }
        if (projectId) {
          qb.andWhere("o_tasks.projectId", projectId);
        }
      })
      .select("o_tasks.*", "o_project.name as projectName")
      .offset(offset)
      .limit(limit)
      .orderBy("o_tasks.id", "desc");
    const totalQuery = (await u
      .db("o_tasks")
      .andWhere((qb) => {
        if (taskClass) {
          qb.andWhere("o_tasks.taskClass", taskClass);
        }
        if (projectId) {
          qb.andWhere("o_tasks.projectId", projectId);
        }
        if (state) {
          qb.andWhere("o_tasks.state", state);
        }
      })
      .count("* as total")
      .first()) as any;
    res.status(200).send(success({ data: await enrichTasks(data), total: totalQuery?.total }));
  },
);
