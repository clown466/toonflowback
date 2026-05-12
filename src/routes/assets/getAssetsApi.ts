import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 获取资产
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    type: z.string(),
    name: z.string().optional(),
    page: z.number(),
    limit: z.number(),
    includeHistoryImages: z.boolean().optional(),
  }),
  async (req, res) => {
    const { projectId, type, name, page = 1, limit = 10, includeHistoryImages = false } = req.body;
    const offset = (page - 1) * limit;
    let query = u
      .db("o_assets")
      .leftJoin("o_image", "o_assets.imageId", "o_image.id")
      .select("o_assets.*", "o_image.filePath", "o_image.state")
      .where("o_assets.projectId", projectId)
      .andWhere("o_assets.type", type);
    if (name) {
      query = query.andWhere("name", "like", `%${name}%`);
    }
    // 分页查询
    const parentAssets = await query.where("o_assets.assetsId", null).offset(offset).limit(limit);

    // 获取所有子资产供关联使用
    let childQuery = u
      .db("o_assets")
      .leftJoin("o_image", "o_assets.imageId", "o_image.id")
      .select("o_assets.*", "o_image.filePath", "o_image.state", "o_image.errorReason")
      .where("o_assets.projectId", projectId)
      .andWhere("o_assets.type", type)
      .whereNotNull("o_assets.assetsId");
    if (name) {
      childQuery = childQuery.andWhere("o_assets.name", "like", `%${name}%`);
    }
    const childAssets = await childQuery;
    const allLoadedAssets = [...parentAssets, ...childAssets];
    const latestImagesByAssetId = await getLatestImagesByAssetId(allLoadedAssets);
    const historyImagesByAssetId = includeHistoryImages
      ? await getHistoryImagesByAssetId(allLoadedAssets)
      : new Map<number, any[]>();

    // 为每个子资产添加图片地址
    const childAssetsWithSrc = await Promise.all(
      childAssets.map(async (child) => ({
        ...child,
        ...latestImageFields(latestImagesByAssetId.get(Number(child.id))),
        src: child.filePath && (await filterTypeGetFileUrl(child.filePath!, child.type)),
        historyImages: historyImagesByAssetId.get(Number(child.id)) ?? [],
      })),
    );

    // 为每个父资产添加子资产
    const result = await Promise.all(
      parentAssets.map(async (parent) => ({
        ...parent,
        ...latestImageFields(latestImagesByAssetId.get(Number(parent.id))),
        sonAssets: childAssetsWithSrc.filter((child) => child.assetsId === parent.id),
        src: parent.filePath && (await filterTypeGetFileUrl(parent.filePath!, parent.type)),
        historyImages: historyImagesByAssetId.get(Number(parent.id)) ?? [],
        ...(parent.type == "audio" ? { sex: parent.describe?.split("|")[0], describe: parent.describe?.split("|")[1] } : {}),
      })),
    );

    // 统计总数
    const totalQuery = (await u
      .db("o_assets")
      .where("projectId", projectId)
      .andWhere("type", type)
      .andWhere("assetsId", null)
      .andWhere((qb) => {
        if (name) {
          qb.andWhere("name", "like", `%${name}%`);
        }
      })
      .count("* as total")
      .first()) as any;
    res.status(200).send(success({ data: result, total: totalQuery?.total }));
  },
);

async function filterTypeGetFileUrl(url: string, type: string) {
  if (type == 'role' || type == 'tool' || type == 'scene') {
    return await u.oss.getSmallImageUrl(url)
  } else {
    return await u.oss.getFileUrl(url)
  }
}

function latestImageFields(image: any | undefined) {
  return {
    latestImageId: image?.id ?? null,
    latestImageState: image?.state ?? null,
    latestImageErrorReason: image?.errorReason ?? null,
    latestImageFilePath: image?.filePath ?? null,
  };
}

async function getLatestImagesByAssetId(assets: any[]) {
  const assetIds = assets.map((asset) => Number(asset.id)).filter((id) => Number.isFinite(id));
  if (!assetIds.length) return new Map<number, any>();
  const rows = await u
    .db("o_image")
    .whereIn("assetsId", assetIds)
    .select("id", "assetsId", "filePath", "state", "errorReason")
    .orderBy("id", "desc");

  const latest = new Map<number, any>();
  rows.forEach((row: any) => {
    const assetId = Number(row.assetsId);
    if (!latest.has(assetId)) latest.set(assetId, row);
  });
  return latest;
}

async function getHistoryImagesByAssetId(assets: any[]) {
  const assetTypeById = new Map<number, string>();
  const selectedImageByAssetId = new Map<number, number>();

  assets.forEach((asset) => {
    const assetId = Number(asset.id);
    if (!Number.isFinite(assetId)) return;
    assetTypeById.set(assetId, asset.type);
    if (asset.imageId != null) selectedImageByAssetId.set(assetId, Number(asset.imageId));
  });

  const assetIds = [...assetTypeById.keys()];
  if (!assetIds.length) return new Map<number, any[]>();

  const images = await u
    .db("o_image")
    .whereIn("assetsId", assetIds)
    .select("id", "filePath", "assetsId", "type", "state", "errorReason")
    .orderBy("id", "desc");

  const imagesWithUrl = await Promise.all(
    images.map(async (image: any) => {
      const assetId = Number(image.assetsId);
      const filePath = image.filePath
        ? await filterTypeGetFileUrl(image.filePath, assetTypeById.get(assetId) || image.type)
        : "";
      return {
        ...image,
        filePath,
        src: filePath,
        selected: selectedImageByAssetId.get(assetId) === Number(image.id),
      };
    }),
  );

  const historyImagesByAssetId = new Map<number, any[]>();
  imagesWithUrl.forEach((image: any) => {
    const assetId = Number(image.assetsId);
    const current = historyImagesByAssetId.get(assetId) ?? [];
    current.push(image);
    historyImagesByAssetId.set(assetId, current);
  });

  return historyImagesByAssetId;
}
