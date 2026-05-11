import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

interface VideoItem {
  id: number;
  src: string;
  state: "未生成" | "生成中" | "已完成" | "生成失败";
}

interface TrackMedia {
  src: string;
  id?: number;
  sources?: string;
  type?: string;
  fileType: "image" | "video" | "audio";
  videoDesc?: string;
  prompt?: string;
  label?: string;
  index?: number;
}

interface TrackItem {
  id?: number;
  prompt: string;
  state: "未生成" | "生成中" | "已完成" | "生成失败";
  reason?: string;
  duration?: number;
  selectVideoId?: number;
  medias: TrackMedia[];
  videoList: VideoItem[];
}

function parseNumberArray(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number).filter((item) => Number.isFinite(item));
  try {
    const parsed = JSON.parse(String(value || "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed.map(Number).filter((item) => Number.isFinite(item));
  } catch {
    return [];
  }
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
  }),
  async (req, res) => {
    const { projectId, scriptId } = req.body;
    const projectData = await u.db("o_project").where("id", projectId).select("id", "videoModel", "mode").first();

    if (!projectData?.videoModel) {
      return res.status(400).json(success("项目未配置视频模型"));
    }
    let videoMode = "";
    try {
      videoMode = JSON.parse(projectData?.mode ?? "");
    } catch (e) {
      videoMode = projectData?.mode ?? "";
    }
    const isRef = Array.isArray(videoMode) ? true : false;

    const storyboardList = await u.db("o_storyboard").where({ scriptId, projectId }).orderBy("index", "asc");
    await Promise.all(
      storyboardList.map(async (i) => {
        i.filePath = i.filePath ? await u.oss.getSmallImageUrl(i.filePath) : "";
      }),
    );
    const storyboardTrackRecord: Record<number, any[]> = {};
    storyboardList.forEach((i) => {
      if (storyboardTrackRecord[i.trackId!]) {
        storyboardTrackRecord[i.trackId!].push({
          src: i.filePath,
          fileType: "image",
          sources: "storyboard",
          ...(i.prompt != null ? { prompt: i.videoDesc } : {}),
          ...(i.id != null ? { id: i.id } : {}),
          index: i.index,
        });
      } else {
        storyboardTrackRecord[i.trackId!] = [
          {
            src: i.filePath,
            fileType: "image",
            sources: "storyboard",
            ...(i.prompt != null ? { prompt: i.videoDesc } : {}),
            ...(i.id != null ? { id: i.id } : {}),
            index: i.index,
          },
        ];
      }
    });
    // 按 storyboardId 分组的资产数据，key 为 storyboardId
    const otherDataMap: Record<number, any[]> = {};
    if (isRef) {
      const storyIds = storyboardList.map((s) => s.id);
      const assetDatas = await u
        .db("o_assets2Storyboard")
        .leftJoin("o_assets", "o_assets2Storyboard.assetId", "o_assets.id")
        .leftJoin("o_image", "o_image.id", "o_assets.imageId")
        .whereIn("o_assets2Storyboard.storyboardId", storyIds as number[])
        .select("o_assets.*", "o_image.filePath", "o_assets2Storyboard.storyboardId");

      await Promise.all(
        assetDatas.map(async (i) => {
          const item = {
            id: i.id,
            name: i.name,
            describe: i.describe,
            type: i.type,
            fileType: "image" as const,
            sources: "assets",
            src: i.filePath ? await u.oss.getSmallImageUrl(i.filePath) : "",
          };
          const sid = i.storyboardId as number;
          if (!otherDataMap[sid]) otherDataMap[sid] = [];
          otherDataMap[sid].push(item);
        }),
      );
    }

    const trackData = await u.db("o_videoTrack").where({ projectId, scriptId });
    const directorBoardList = (await u.db("o_directorBoard").where({ projectId, scriptId }).orderBy("index", "asc").orderBy("id", "asc")) as any[];
    await Promise.all(
      directorBoardList.map(async (i) => {
        i.src = i.filePath ? await u.oss.getSmallImageUrl(i.filePath) : "";
      }),
    );
    const directorBoardAssetIds = Array.from(new Set(directorBoardList.flatMap((board) => parseNumberArray(board.assetIds))));
    const directorBoardAssetMap = new Map<number, any>();
    if (directorBoardAssetIds.length) {
      const boardAssets = await u
        .db("o_assets")
        .leftJoin("o_image", "o_image.id", "o_assets.imageId")
        .where("o_assets.projectId", projectId)
        .whereIn("o_assets.id", directorBoardAssetIds)
        .select("o_assets.id", "o_assets.name", "o_assets.describe", "o_assets.prompt", "o_assets.type", "o_image.filePath");
      await Promise.all(
        boardAssets.map(async (asset) => {
          directorBoardAssetMap.set(Number(asset.id), {
            id: asset.id,
            name: asset.name,
            describe: asset.describe,
            prompt: asset.prompt,
            type: asset.type,
            fileType: "image",
            sources: "assets",
            src: asset.filePath ? await u.oss.getSmallImageUrl(asset.filePath) : "",
          });
        }),
      );
    }
    directorBoardList.forEach((board) => {
      board.assetRefs = parseNumberArray(board.assetIds)
        .map((id) => directorBoardAssetMap.get(id))
        .filter((asset) => asset?.src);
    });
    const videoList = await u.db("o_video").whereIn(
      "videoTrackId",
      trackData.map((t) => t.id),
    );
    const trackList: TrackItem[] = [];
    const trackIdMap = [...new Set<number>(trackData.map((t) => t.id!))];
    for (const trackId of trackIdMap) {
      const item = trackData.find((t) => t.id === trackId);
      trackList.push({
        id: trackId,
        duration: item?.duration ?? 0,
        prompt: item?.prompt || "",
        state: (item?.state as "未生成" | "生成中" | "已完成" | "生成失败") ?? "未生成",
        reason: item?.reason ?? "",
        selectVideoId: Number(item?.videoId)!,
        medias: (() => {
          const storyboardMedias = storyboardTrackRecord[trackId] ?? [];
          const assetMedias = storyboardMedias.flatMap((s) => otherDataMap[s.id] ?? []);
          const seenAssetIds = new Set<number>();
          const uniqueAssets = assetMedias.filter((a) => {
            if (seenAssetIds.has(a.id)) return false;
            seenAssetIds.add(a.id);
            return true;
          });
          const assetPriority: Record<string, number> = { role: 0, scene: 1, tool: 2 };
          const sortAssetMedia = (a: TrackMedia, b: TrackMedia) => (assetPriority[a.type || ""] ?? 3) - (assetPriority[b.type || ""] ?? 3);
          const hasImageAssetData = uniqueAssets.filter((i) => i.src).sort(sortAssetMedia);
          const notHasImageAssetData = uniqueAssets.filter((i) => !i.src);

          return [...hasImageAssetData, ...storyboardMedias, ...notHasImageAssetData];
        })(),
        videoList: await Promise.all(
          videoList
            .filter((v) => v.videoTrackId === trackId)
            .map(async (v) => ({
              id: v.id!,
              src: v.filePath ? await u.oss.getFileUrl(v.filePath) : "",
              state: v.state === "已完成" || v.state === "生成成功" ? "已完成" : v.state === "生成中" ? "生成中" : v.state === "生成失败" ? "生成失败" : "未生成",
              errorReason: v?.errorReason ?? "",
            })),
        ),
      });
    }
    res.status(200).send(
      success({
        storyboardList: await Promise.all(
          storyboardList.map(async (s) => ({
            ...s,
            src: s.filePath,
          })),
        ),
        directorBoardList,
        trackList,
      }),
    );
  },
);
