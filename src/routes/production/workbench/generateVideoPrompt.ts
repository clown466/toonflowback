import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

function buildDirectorBoardVideoPromptRules(hasDirectorBoard: boolean) {
  if (!hasDirectorBoard) return "";
  return [
    "**章节导演板视频提示词输出规则（最高优先级）**：",
    "1. 存在章节导演板参考时，输出必须按镜头拆分，禁止合并成一整段连续描述。",
    "2. 每个 <storyboardItem> 至少对应一个独立镜头段落，使用类似 `镜头1：`、`镜头2：` 的清晰编号；如果源项目/对白为英文，可使用 `Shot 1:`、`Shot 2:`，但不要中英混杂。",
    "3. 每个镜头段落必须包含：时长、导演板参考作用、角色/资产参考、景别、运镜、角色动作、空间站位/运动方向、光影氛围、台词/无台词、音效。",
    "4. 章节导演板只作为空间、机位、角色站位、动作方向、场景连续性的第一参考；角色最终外观、脸、服装、身体材质、比例、武器细节以资产参考图为最高优先级。",
    "5. 导演板中的铅笔线稿、符号角色或简化角色不可当作最终角色长相参考；不要让导演板里可能不准确的角色形象覆盖资产图。",
    "6. 单次视频片段总时长必须服从当前轨道时长和视频模型限制；章节导演板通常对应 4-15 秒视频片段。",
    "7. 输出只给可直接发送给视频模型的视频提示词，不要解释规则，不要输出 XML，不要输出分析过程。",
    "",
    "推荐输出结构：",
    "参考优先级：资产参考图 > 章节导演板空间/机位/连续性 > 分镜文字。",
    "总片段：{总时长}s，按导演板覆盖范围生成。",
    "镜头1：{时长}，{景别/机位/运镜}，{角色与站位}，{动作}，{光影/场景连续性}，{台词或无台词}，{音效}。",
    "镜头2：{时长}，{景别/机位/运镜}，{角色与站位}，{动作}，{光影/场景连续性}，{台词或无台词}，{音效}。",
  ].join("\n");
}

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
    const directorBoardVideoPromptRules = buildDirectorBoardVideoPromptRules(directorBoards.some((i) => i.filePath));
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
          **导演板使用规则**：如果存在章节导演板参考，默认把它作为空间、机位、角色站位、动作方向、场景连续性的第一参考；但角色最终外观、脸、服装、身体材质、比例和武器细节必须以资产参考图为最高优先级。导演板中的铅笔线稿、符号角色或简化角色只表达位置、朝向、动作和情绪，不可当作角色长相参考；不要让导演板里可能不准确的角色形象覆盖资产图。分镜图只作为更细的单镜首帧补充，不要让单镜首帧推翻导演板的空间连续性。
          ${directorBoardVideoPromptRules}
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
