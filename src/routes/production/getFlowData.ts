import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();
import { FlowData } from "@/agents/productionAgent/tools";

type MaybeId = number | null | undefined;
type FlowAsset = FlowData["assets"][number];
type FlowAssetType = FlowAsset["type"];
type FlowAssetState = FlowAsset["derive"][number]["state"];

function isValidId(id: MaybeId): id is number {
  return typeof id === "number" && Number.isFinite(id);
}

async function getSmallImageUrl(filePath?: string | null) {
  if (!filePath) return null;
  try {
    return await u.oss.getSmallImageUrl(filePath);
  } catch {
    return null;
  }
}

function normalizeAssetType(type: unknown): FlowAssetType {
  return type as FlowAssetType;
}

function normalizeAssetState(state: unknown): FlowAssetState {
  return state === "已完成" || state === "生成中" || state === "生成失败" ? state : "未生成";
}

function emptyFlowData(script = ""): FlowData {
  return {
    script,
    scriptPlan: "",
    assets: [],
    storyboardTable: "",
    storyboard: [],
    //todo：矫正workbench数据
    //@ts-ignore
    workbench: {
      videoList: [],
    },
    // //todo：矫正封面数据
    // poster: {
    //   items: [],
    // },
  };
}

function parseFlowData(data: string | null | undefined, script: string): FlowData {
  if (!data) return emptyFlowData(script);
  try {
    return { ...emptyFlowData(script), ...JSON.parse(data) };
  } catch {
    return emptyFlowData(script);
  }
}

export async function getProjectLevelAssets(projectId: number, episodesId?: MaybeId): Promise<FlowData["assets"]> {
  const scriptAssets = isValidId(episodesId) ? await u.db("o_scriptAssets").where("scriptId", episodesId) : [];
  const assetIds = scriptAssets.map((i) => Number(i.assetId)).filter((id) => Number.isFinite(id));
  const assetsQuery = u
    .db("o_assets")
    .leftJoin("o_image", "o_assets.imageId", "o_image.id")
    .select("o_assets.*", "o_image.filePath", "o_image.state as imageState", "o_image.errorReason as imageErrorReason")
    .where("o_assets.projectId", projectId)
    .whereNull("o_assets.assetsId");

  if (assetIds.length > 0) {
    assetsQuery.orderByRaw(`CASE WHEN o_assets.id IN (${assetIds.map(() => "?").join(",")}) THEN 0 ELSE 1 END`, assetIds);
  }
  assetsQuery.orderByRaw(`CASE o_assets.type WHEN 'role' THEN 1 WHEN 'scene' THEN 2 WHEN 'tool' THEN 3 ELSE 4 END`).orderBy("o_assets.id", "asc");

  const assetsData = await assetsQuery;
  const parentAssetIds = assetsData.map((item) => item.id).filter((id) => Number.isFinite(Number(id)));

  const childAssetsData = parentAssetIds.length
    ? await u
        .db("o_assets")
        .leftJoin("o_image", "o_assets.imageId", "o_image.id")
        .select("o_assets.*", "o_image.filePath", "o_image.state as imageState", "o_image.errorReason as imageErrorReason")
        .where("o_assets.projectId", projectId)
        .whereIn("o_assets.assetsId", parentAssetIds)
        .whereNotNull("o_assets.assetsId")
    : [];

  return Promise.all(
    assetsData.map(async (item) => ({
      id: item.id,
      name: item.name ?? "",
      type: normalizeAssetType(item.type),
      prompt: item.prompt ?? "",
      desc: item.describe ?? "",
      src: await getSmallImageUrl(item.filePath),
      state: normalizeAssetState(item.imageState),
      errorReason: item.imageErrorReason ?? "",
      flowId: item.flowId,
      derive: await Promise.all(
        childAssetsData
          .filter((child) => child.assetsId === item.id)
          .map(async (child) => ({
            id: child.id,
            assetsId: item.id,
            name: child.name ?? "",
            type: normalizeAssetType(child.type),
            prompt: child.prompt ?? "",
            desc: child.describe ?? "",
            src: await getSmallImageUrl(child.filePath),
            state: normalizeAssetState(child.imageState),
            errorReason: child.imageErrorReason ?? "",
            flowId: child.flowId,
          })),
      ),
    })),
  );
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodesId: z.number().optional().nullable(),
  }),
  async (req, res) => {
    const { projectId, episodesId }: { projectId: number; episodesId?: MaybeId } = req.body;
    const [sqlData, scriptData, assets] = await Promise.all([
      isValidId(episodesId)
        ? u
            .db("o_agentWorkData")
            .where("projectId", String(projectId))
            .andWhere("episodesId", String(episodesId))
            .select("data")
            .first()
        : null,
      isValidId(episodesId) ? u.db("o_script").where("projectId", projectId).where("id", episodesId).first() : null,
      getProjectLevelAssets(projectId, episodesId),
    ]);

    if (!sqlData) {
      const flowData = emptyFlowData(scriptData?.content ?? "");
      flowData.assets = assets;
      return res.status(200).send(success(flowData));
    } else {
      try {
        const storyboardData = isValidId(episodesId) ? await u.db("o_storyboard").where("scriptId", episodesId) : [];

        await Promise.all(
          storyboardData.map(async (i) => {
            if (i.filePath) {
              try {
                i.filePath = await u.oss.getSmallImageUrl(i.filePath);
              } catch {
                i.filePath = "";
              }
            } else {
              i.filePath = "";
            }
          }),
        );
        const storyboardIds = storyboardData.map((i) => i.id);
        const assetsIds = await u.db("o_assets2Storyboard").whereIn("storyboardId", storyboardIds).orderBy("rowid");

        const assets2StoryboardMap: Record<number, number[]> = {};
        assetsIds.forEach((i) => {
          if (!assets2StoryboardMap[i.storyboardId!]) {
            assets2StoryboardMap[i.storyboardId!] = [];
          }
          assets2StoryboardMap[i.storyboardId!].push(i.assetId!);
        });
        const flowData: any = parseFlowData(sqlData!.data, scriptData?.content ?? "");
        flowData.assets = assets;
        flowData.storyboard = storyboardData
          .map((i) => ({
            id: i.id,
            index: i.index,
            duration: i.duration ? +i.duration : 0,
            prompt: i.prompt,
            associateAssetsIds: assets2StoryboardMap[i.id!] ?? [],
            src: i.filePath,
            state: i.state,
            videoDesc: i.videoDesc,
            shouldGenerateImage: i.shouldGenerateImage,
            reason: i?.reason ?? "",
            flowId: i.flowId,
          }))
          .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        res.status(200).send(success(flowData));
      } catch (err) {
        res.status(400).send(error());
      }
    }
  },
);
