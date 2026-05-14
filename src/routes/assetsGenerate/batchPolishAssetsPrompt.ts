import express from "express";
import u from "@/utils";
import pLimit from "p-limit";
import * as zod from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { normalizeAssetSourcePrompt } from "@/services/assetImageGeneration";
import { formatProjectFactBundleForPrompt, loadProjectFactBundle } from "@/services/imageGenerationSkill";
const router = express.Router();
interface OutlineItem {
  description: string;
  name: string;
}

interface OutlineData {
  chapterRange: number[];
  characters?: OutlineItem[];
  props?: OutlineItem[];
  scenes?: OutlineItem[];
}

interface NovelChapter {
  id: number;
  reel: string;
  chapter: string;
  chapterData: string;
  projectId: number;
}

type ItemType = "characters" | "props" | "scenes";

//润色提示词
export default router.post(
  "/",
  validateFields({
    items: zod.array(
      zod.object({
        assetsId: zod.number(),
        type: zod.string(),
        name: zod.string(),
        describe: zod.string(),
      }),
    ),
    projectId: zod.number(),
    concurrentCount: zod.number().int().min(1).optional(),
  }),
  async (req, res) => {
    const { projectId, items, concurrentCount } = req.body;
    //获取风格
    const project = await u.db("o_project").where("id", projectId).select("artStyle", "type", "intro").first();
    //如果没有找到对应的项目，返回错误
    if (!project) return res.status(500).send(success({ message: "项目为空" }));

    // 预加载公共数据
    const assetsIds = items.map((item: { assetsId: number }) => item.assetsId);
    //查询所有资产，用于判断每个资产是否是衍生资产
    const assetsDataList = await u.db("o_assets").whereIn("id", assetsIds).select("id", "assetsId");
    if (!assetsDataList || assetsDataList.length === 0) return res.status(500).send(error("资产不存在"));
    const assetsDataMap = new Map(assetsDataList.map((a: any) => [a.id, a]));
    // 所有前置检测通过后，再批量更新状态为生成中
    await u.db("o_assets").whereIn("id", assetsIds).update({ promptState: "生成中" });

    const getTypeConfig = (
      isDerivative: boolean,
    ): Record<string, { promptKey: string; itemType: ItemType; label: string; nameLabel: string; visualManual: string }> => ({
      role: {
        promptKey: "role-polish",
        itemType: "characters",
        label: "角色标准四视图",
        nameLabel: "角色",
        visualManual: isDerivative ? "art_character_derivative" : "art_character",
      },
      scene: {
        promptKey: "scene-polish",
        itemType: "scenes",
        label: "场景图",
        nameLabel: "场景",
        visualManual: isDerivative ? "art_scene_derivative" : "art_scene",
      },
      tool: {
        promptKey: "tool-polish",
        itemType: "props",
        label: "道具图",
        nameLabel: "道具",
        visualManual: isDerivative ? "art_prop_derivative" : "art_prop",
      },
    });

    // 后台异步并发生成，不阻塞响应
    const limit = pLimit(concurrentCount ?? 1);
    const tasks = items.map((item: { assetsId: number; type: string; name: string; describe: string }) =>
      limit(async () => {
        const assetData = assetsDataMap.get(item.assetsId);
        if (!assetData) return;
        const typeConfig = getTypeConfig(!!assetData.assetsId);
        const config = typeConfig[item.type];
        if (!config) return;
        //获取到视觉手册
        const visualManual = await u.getArtPrompt(project.artStyle as string, "art_skills", config.visualManual);
        if (!visualManual) {
          await u.db("o_assets").where("id", item.assetsId).update({ promptState: "生成失败", promptErrorReason: "视觉手册未定义" });
          return;
        }
        const systemPrompt = `${visualManual}

你正在生成资产中心保存的“资产描述词”，不是最终生图请求。只输出资产本身的稳定视觉描述，不要输出冲突优先级、项目事实源、视觉手册原文、JSON 或 Markdown 标题。`;
        try {
          const factBundle = await loadProjectFactBundle({ projectId, assetId: item.assetsId });
          const factBundlePrompt = formatProjectFactBundleForPrompt(factBundle, { assetId: item.assetsId, includeProject: true, maxAssets: 4 });
          const { _output } = (await u.Ai.Text("universalAi").invoke({
            system: systemPrompt,
            messages: [
              {
                role: "user",
                content: `**冲突优先级（必须遵守）：**
角色事实卡/上传参考图 > 项目硬约束 > 资产描述 > 视觉手册 > 小说原文。
当名称、描述、小说或视觉手册与角色事实卡/上传参考图冲突时，必须以角色事实卡/上传参考图为准。

**项目和资产事实：**
${factBundlePrompt || "无"}

**基础参数：**
- 项目画风:${project.artStyle || "未指定"}
- 项目类型:${project.type || "未指定"}
- 项目简介:${project.intro || "无"}

**${config.nameLabel}设定：**
- ${config.nameLabel}名称:${item.name}
- ${config.nameLabel}描述:${item.describe}

请只输出一段可保存到资产中心的资产描述词。`,
              },
            ],
          })) as any;

          if (!_output) {
            await u.db("o_assets").where("id", item.assetsId).update({ promptState: "生成失败" });
            return;
          }

          const sourcePrompt = normalizeAssetSourcePrompt(_output, item.describe || item.name);
          await u.db("o_assets").where("id", item.assetsId).update({ prompt: sourcePrompt, promptState: "已完成" });
        } catch (e: any) {
          await u
            .db("o_assets")
            .where("id", item.assetsId)
            .update({ promptState: "失败", promptErrorReason: u.error(e).message });
        }
      }),
    );

    // 后台执行，不等待结果
    Promise.all(tasks).catch((err: any) => {
      res.status(500).send(error(err));
    });

    return res.status(200).send(success({ total: items.length }));
  },
);
