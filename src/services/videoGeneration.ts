import { v4 as uuidv4 } from "uuid";
import u from "@/utils";

export type VideoUploadSource = "assets" | "storyboard" | "directorBoard";
export type VideoUploadType = "imageReference" | "startImage" | "endImage" | "videoReference" | "audioReference";

export interface VideoUploadItem {
  fileType?: "image" | "video" | "audio";
  type?: VideoUploadType;
  sources?: VideoUploadSource;
  id?: number;
  src?: string;
  label?: string;
  prompt?: string;
}

export interface SubmitVideoGenerationInput {
  projectId: number;
  scriptId: number;
  uploadData: VideoUploadItem[];
  prompt: string;
  model: string;
  mode: string | string[];
  resolution: string;
  duration: number;
  audio?: boolean;
  trackId: number;
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

function parseDuration(value: unknown) {
  const duration = Number(String(value ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

async function getDirectorBoardDuration(projectId: number, uploadData: VideoUploadItem[]) {
  const directorBoardIds = uploadData.filter((item) => item.sources === "directorBoard").map((item) => Number(item.id)).filter((id) => Number.isFinite(id));
  if (!directorBoardIds.length) return 0;

  const boards = await u.db("o_directorBoard").where({ projectId }).whereIn("id", directorBoardIds).select("storyboardIds");
  const storyboardIds = Array.from(new Set(boards.flatMap((board: any) => parseNumberArray(board.storyboardIds))));
  if (!storyboardIds.length) return 0;

  const rows = await u.db("o_storyboard").where({ projectId }).whereIn("id", storyboardIds).select("duration");
  return rows.reduce((sum: number, row: any) => sum + parseDuration(row.duration), 0);
}

function normalizeMode(mode: string | string[]) {
  if (Array.isArray(mode)) return mode;
  if (typeof mode === "string" && mode.startsWith('["') && mode.endsWith('"]')) {
    try {
      const parsed = JSON.parse(mode);
      return Array.isArray(parsed) ? parsed : mode;
    } catch {
      return mode;
    }
  }
  return mode;
}

export async function submitVideoGenerationTask(input: SubmitVideoGenerationInput) {
  const { scriptId, projectId, prompt, uploadData, model, duration, resolution, audio, mode, trackId } = input;
  const directorBoardDuration = await getDirectorBoardDuration(projectId, uploadData);
  const effectiveDuration = directorBoardDuration > 0 ? directorBoardDuration : duration;
  const videoRatioRow = await u.db("o_project").select("videoRatio").where("id", projectId).first();
  const videoPath = `/${projectId}/video/${uuidv4()}.mp4`;

  const images = await Promise.all(
    uploadData.map(async (item) => {
      if (item.sources === "storyboard") {
        const filePath = await u.db("o_storyboard").where("id", item.id).where({ projectId, scriptId }).select("filePath").first();
        return filePath?.filePath;
      }
      if (item.sources === "assets") {
        const filePath = await u
          .db("o_assets")
          .where("o_assets.id", item.id)
          .where("o_assets.projectId", projectId)
          .leftJoin("o_image", "o_assets.imageId", "o_image.id")
          .select("o_image.filePath")
          .first();
        return filePath?.filePath;
      }
      if (item.sources === "directorBoard") {
        const filePath = await u.db("o_directorBoard").where({ id: item.id, projectId, scriptId }).select("filePath").first();
        return filePath?.filePath;
      }
      return undefined;
    }),
  );
  const base64 = await Promise.all(
    images.map(async (item) => {
      if (!item) return null;
      return await u.oss.getImageBase64(item);
    }),
  );
  const [videoId] = await u.db("o_video").insert({
    filePath: videoPath,
    time: Date.now(),
    state: "生成中",
    scriptId,
    projectId,
    videoTrackId: trackId,
  });

  void (async () => {
    try {
      const relatedObjects = {
        projectId,
        videoId,
        scriptId,
        type: "视频",
      };
      const aiVideo = u.Ai.Video(model as `${string}:${string}`);
      await aiVideo.run(
        {
          prompt,
          referenceList: base64.filter((item) => item !== null).map((item) => ({ type: "image" as const, base64: item! })),
          mode: normalizeMode(mode) as any,
          duration: effectiveDuration,
          aspectRatio: (videoRatioRow?.videoRatio as "16:9" | "9:16") || "16:9",
          resolution,
          audio,
        },
        {
          projectId,
          taskClass: "视频生成",
          describe: "根据提示词生成视频",
          relatedObjects: JSON.stringify(relatedObjects),
        },
      );
      await aiVideo.save(videoPath);
      await u.db("o_video").where("id", videoId).update({ state: "生成成功" });
      await u.db("o_videoTrack").where({ id: trackId, projectId }).update({ state: "已完成", videoId, reason: "" });
    } catch (error: any) {
      const errorReason = u.error(error).message;
      await u
        .db("o_video")
        .where("id", videoId)
        .update({
          state: "生成失败",
          errorReason,
        });
      await u.db("o_videoTrack").where({ id: trackId, projectId }).update({ state: "生成失败", reason: errorReason });
    }
  })();

  await u.db("o_videoTrack").where({ id: trackId, projectId }).update({ state: "生成中", videoId, duration: effectiveDuration });
  return {
    projectId,
    scriptId,
    trackId,
    videoId,
    effectiveDuration,
    referenceCount: base64.filter(Boolean).length,
  };
}
