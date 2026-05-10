import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { z } from "zod";

const router = express.Router();

type ImageHistorySource = "asset" | "storyboard" | "directorBoard";

interface ImageHistoryItem {
  id: string;
  source: ImageHistorySource;
  sourceLabel: string;
  entityId: number;
  projectId: number | null;
  projectName: string;
  scriptId?: number | null;
  scriptName?: string | null;
  title: string;
  prompt?: string | null;
  model?: string | null;
  resolution?: string | null;
  state?: string | null;
  errorReason?: string | null;
  src: string;
  previewSrc: string;
  sortAt: number;
}

function toNumber(value: unknown, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

async function toImageUrls(filePath?: string | null) {
  if (!filePath) return { src: "", previewSrc: "" };
  return {
    src: await u.oss.getSmallImageUrl(filePath),
    previewSrc: await u.oss.getFileUrl(filePath),
  };
}

function matchesFilter(item: ImageHistoryItem, source: string | null | undefined, state: string | null | undefined) {
  if (source && item.source !== source) return false;
  if (state && item.state !== state) return false;
  return true;
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number().optional().nullable(),
    source: z.enum(["asset", "storyboard", "directorBoard"]).optional().nullable(),
    state: z.string().optional().nullable(),
    page: z.number().min(1).optional(),
    limit: z.number().min(1).max(100).optional(),
  }),
  async (req, res) => {
    const { projectId, source, state, page = 1, limit = 24 } = req.body;
    const projectFilter = typeof projectId === "number" && projectId > 0 ? projectId : null;

    const [assetRows, storyboardRows, directorBoardRows] = await Promise.all([
      u
        .db("o_image")
        .leftJoin("o_assets", "o_image.assetsId", "o_assets.id")
        .leftJoin("o_project", "o_assets.projectId", "o_project.id")
        .modify((qb) => {
          if (projectFilter) qb.where("o_assets.projectId", projectFilter);
        })
        .select(
          "o_image.id as imageId",
          "o_image.filePath",
          "o_image.type as imageType",
          "o_image.model",
          "o_image.resolution",
          "o_image.state",
          "o_image.errorReason",
          "o_assets.id as assetId",
          "o_assets.name as assetName",
          "o_assets.type as assetType",
          "o_assets.prompt",
          "o_assets.describe",
          "o_assets.projectId",
          "o_project.name as projectName",
        ),
      u
        .db("o_storyboard")
        .leftJoin("o_script", "o_storyboard.scriptId", "o_script.id")
        .leftJoin("o_project", "o_storyboard.projectId", "o_project.id")
        .modify((qb) => {
          if (projectFilter) qb.where("o_storyboard.projectId", projectFilter);
        })
        .select(
          "o_storyboard.id",
          "o_storyboard.filePath",
          "o_storyboard.prompt",
          "o_storyboard.videoDesc",
          "o_storyboard.state",
          "o_storyboard.reason",
          "o_storyboard.projectId",
          "o_storyboard.scriptId",
          "o_storyboard.index",
          "o_storyboard.createTime",
          "o_script.name as scriptName",
          "o_project.name as projectName",
        ),
      u
        .db("o_directorBoard")
        .leftJoin("o_script", "o_directorBoard.scriptId", "o_script.id")
        .leftJoin("o_project", "o_directorBoard.projectId", "o_project.id")
        .modify((qb) => {
          if (projectFilter) qb.where("o_directorBoard.projectId", projectFilter);
        })
        .select(
          "o_directorBoard.id",
          "o_directorBoard.filePath",
          "o_directorBoard.name",
          "o_directorBoard.prompt",
          "o_directorBoard.state",
          "o_directorBoard.reason",
          "o_directorBoard.model",
          "o_directorBoard.boardType",
          "o_directorBoard.projectId",
          "o_directorBoard.scriptId",
          "o_directorBoard.index",
          "o_directorBoard.createTime",
          "o_directorBoard.updateTime",
          "o_script.name as scriptName",
          "o_project.name as projectName",
        ),
    ]);

    const items: ImageHistoryItem[] = [];

    for (const row of assetRows as any[]) {
      const urls = await toImageUrls(row.filePath);
      const assetType = row.assetType || row.imageType || "asset";
      items.push({
        id: `asset-${row.imageId}`,
        source: "asset",
        sourceLabel: assetType === "role" ? "角色资产" : assetType === "scene" ? "场景资产" : assetType === "tool" ? "道具资产" : "资产图",
        entityId: toNumber(row.assetId || row.imageId),
        projectId: row.projectId ?? null,
        projectName: row.projectName || "未命名项目",
        title: row.assetName || `${assetType} #${row.imageId}`,
        prompt: row.prompt || row.describe || "",
        model: row.model || null,
        resolution: row.resolution || null,
        state: row.state || null,
        errorReason: row.errorReason || null,
        src: urls.src,
        previewSrc: urls.previewSrc,
        sortAt: toNumber(row.imageId),
      });
    }

    for (const row of storyboardRows as any[]) {
      const urls = await toImageUrls(row.filePath);
      const index = Number.isFinite(Number(row.index)) ? Number(row.index) + 1 : row.id;
      items.push({
        id: `storyboard-${row.id}`,
        source: "storyboard",
        sourceLabel: "分镜图",
        entityId: toNumber(row.id),
        projectId: row.projectId ?? null,
        projectName: row.projectName || "未命名项目",
        scriptId: row.scriptId ?? null,
        scriptName: row.scriptName || null,
        title: `S${String(index).padStart(2, "0")} ${row.scriptName || ""}`.trim(),
        prompt: row.prompt || row.videoDesc || "",
        state: row.state || null,
        errorReason: row.reason || null,
        src: urls.src,
        previewSrc: urls.previewSrc,
        sortAt: toNumber(row.createTime, toNumber(row.id)),
      });
    }

    for (const row of directorBoardRows as any[]) {
      const urls = await toImageUrls(row.filePath);
      items.push({
        id: `directorBoard-${row.id}`,
        source: "directorBoard",
        sourceLabel: "章节导演板",
        entityId: toNumber(row.id),
        projectId: row.projectId ?? null,
        projectName: row.projectName || "未命名项目",
        scriptId: row.scriptId ?? null,
        scriptName: row.scriptName || null,
        title: row.name || `章节导演板 #${row.id}`,
        prompt: row.prompt || "",
        model: row.model || null,
        resolution: row.boardType || null,
        state: row.state || null,
        errorReason: row.reason || null,
        src: urls.src,
        previewSrc: urls.previewSrc,
        sortAt: toNumber(row.updateTime, toNumber(row.createTime, toNumber(row.id))),
      });
    }

    const filtered = items.filter((item) => matchesFilter(item, source, state)).sort((a, b) => b.sortAt - a.sortAt);
    const offset = (page - 1) * limit;
    res.status(200).send(success({ data: filtered.slice(offset, offset + limit), total: filtered.length }));
  },
);
