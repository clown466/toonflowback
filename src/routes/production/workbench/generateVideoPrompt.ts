import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { info } from "node:console";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    trackId: z.number(),
    projectId: z.number(),
    info: z.array(
      z.object({
        id: z.number(),
        sources: z.string(),
      }),
    ),
    model: z.string(),
  }),
  async (req, res) => {
    const { trackId, projectId, info, model } = req.body;
    //查询参数
    const images = await Promise.all(
      info.map(async (item: { id: number; sources: string }) => {
        if (item.sources === "storyboard") {
          // 查询分镜主信息
          const storyboard = await u
            .db("o_storyboard")
            .where("o_storyboard.id", item.id)
            .select("videoDesc", "prompt", "track", "duration", "shouldGenerateImage")
            .first();
          // 查询分镜关联的资产ID
          const assetRows = await u.db("o_assets2Storyboard").where("storyboardId", item.id).orderBy("rowid").select("assetId");
          const associateAssetsIds = assetRows.map((row: any) => row.assetId);
          return {
            ...storyboard,
            associateAssetsIds,
            _type: "storyboard", // 标记类型，便于后续区分
          };
        }
        if (item.sources === "assets") {
          // 查询素材
          const assetsData = await u
            .db("o_assets")
            .leftJoin("o_image", "o_image.id", "o_assets.imageId")
            .where("o_assets.id", item.id)
            .select("o_assets.id", "o_assets.type", "o_assets.name", "o_image.filePath")
            .first();
          return {
            ...assetsData,
            _type: "assets", // 标记类型
          };
        }
        if (item.sources === "directorBoard") {
          const board = await u
            .db("o_directorBoard")
            .where("id", item.id)
            .select("id", "name", "prompt", "filePath", "storyboardIds")
            .first();
          return {
            ...board,
            _type: "directorBoard",
          };
        }
      }),
    );

    // 拆分 assets 和 storyboard
    const assets: any[] = [];
    const storyboard: any[] = [];
    const directorBoards: any[] = [];
    for (const item of images) {
      if (!item) continue; // 忽略空
      if (item._type === "assets")
        assets.push({
          id: item.id,
          type: item.type,
          name: item.name,
          filePath: item.filePath,
        });
      if (item._type === "storyboard")
        storyboard.push({
          videoDesc: item.videoDesc,
          prompt: item.prompt,
          track: item.track,
          duration: item.duration,
          associateAssetsIds: item.associateAssetsIds,
          shouldGenerateImage: item.shouldGenerateImage,
        });
      if (item._type === "directorBoard")
        directorBoards.push({
          id: item.id,
          name: item.name,
          prompt: item.prompt,
          filePath: item.filePath,
          storyboardIds: item.storyboardIds,
        });
    }
    const [id, modelData] = model.split(/:(.+)/);
    const projectData = await u.db("o_project").select("*").where({ id: projectId }).first();
    const videoPrompt = await u.db("o_prompt").where("type", "videoPromptGeneration").first();
    let videoPromptGeneration = "" as string | undefined;
    if (videoPrompt && videoPrompt.useData) {
      videoPromptGeneration = videoPrompt.useData;
    } else {
      videoPromptGeneration = videoPrompt?.data ?? undefined;
    }
    const artStyle = projectData?.artStyle || "无";
    const visualManual = u.getArtPrompt(artStyle, "art_skills", "art_storyboard_video");
    const content = `
          **模型名称**：${modelData},
          **资产信息**（角色、场景、道具):${assets
        .filter((i) => i.filePath)
        .map((i) => `[${i.id},${i.type},${i.name}]`)
        .join("，")},
          **章节导演板参考**：${directorBoards
        .filter((i) => i.filePath)
        .map((i) => `[${i.id},directorBoard,${i.name || "章节导演板"},覆盖分镜=${i.storyboardIds || "[]"}]`)
        .join("，")},
          **导演板使用规则**：如果存在章节导演板参考，默认把它作为空间、机位、角色位置、角色状态、场景连续性的第一参考；分镜图只作为更细的单镜首帧补充，不要让单镜首帧推翻导演板的空间连续性。
          **分镜信息**：${storyboard.map(
          (i) => `<storyboardItem
  videoDesc='${i.videoDesc}'
  duration='${i.duration}'
  prompt='${(i.prompt || "").replace(/'/g, "\\'")}'
  track='${i.track}'
  associateAssetsIds='${JSON.stringify(i.associateAssetsIds || [])}'
  shouldGenerateImage='${i.shouldGenerateImage !== false && i.shouldGenerateImage !== 0 ? "true" : "false"}'
></storyboardItem>`,
        )},
          `;

    try {
      const { text } = await u.Ai.Text("universalAi").invoke({
        system: videoPromptGeneration,
        messages: [
          {
            role: "assistant",
            content: `${visualManual}`,
          },
          {
            role: "user",
            content: content,
          },
        ],
      });
      await u.db("o_videoTrack").where({ id: trackId }).update({
        prompt: text,
      });
      res.status(200).send(success(text));
    } catch (e) {
      res.status(400).send(error(u.error(e).message));
    }
  },
);
