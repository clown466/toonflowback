import express from "express";
import u from "@/utils";
import * as zod from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { buildFinalAssetImagePrompt, normalizeAssetSourcePrompt } from "@/services/assetImageGeneration";
import { formatProjectFactBundleForPrompt, loadProjectFactBundle } from "@/services/imageGenerationSkill";
const router = express.Router();


type ItemType = "characters" | "props" | "scenes";
type AssetImageType = "role" | "scene" | "tool";

//润色提示词
export default router.post(
  "/",
  validateFields({
    assetsId: zod.number(),
    projectId: zod.number(),
    type: zod.string(),
    name: zod.string(),
    describe: zod.string(),
    skillId: zod.string().optional().nullable(),
    userRequirement: zod.string().optional().nullable(),
    responsePromptMode: zod.enum(["source", "final"]).optional(),
  }),
  async (req, res) => {
    const { assetsId, projectId, type, name, describe, skillId, userRequirement, responsePromptMode } = req.body;
    //获取风格
    const project = await u.db("o_project").where("id", projectId).select("artStyle", "type", "intro").first();
    //如果没有找到对应的项目，返回错误
    if (!project) return res.status(500).send(success({ message: "项目为空" }));

    await u.db("o_assets").where("id", assetsId).update({ promptState: "生成中" });

    //查询资产是否是衍生资产
    const assetsData = await u.db("o_assets").where("id", assetsId).select("assetsId").first();
    if (!assetsData) return { code: 500, message: "资产不存在" };
    const typeConfig: Record<string, { promptKey: string; itemType: ItemType; label: string; nameLabel: string; visualManual: string }> = {
      role: {
        promptKey: "role-polish",
        itemType: "characters",
        label: "角色标准四视图",
        nameLabel: "角色",
        visualManual: assetsData.assetsId ? "art_character_derivative" : "art_character",
      },
      scene: {
        promptKey: "scene-polish",
        itemType: "scenes",
        label: "场景图",
        nameLabel: "场景",
        visualManual: assetsData.assetsId ? "art_scene_derivative" : "art_scene",
      },
      tool: {
        promptKey: "tool-polish",
        itemType: "props",
        label: "道具图",
        nameLabel: "道具",
        visualManual: assetsData.assetsId ? "art_prop_derivative" : "art_prop",
      },
    };

    const config = typeConfig[type];
    if (!config) return res.status(500).send(error("不支持的类型"));
    if (!config.visualManual) return res.status(500).send(error("视觉手册未定义"));
    //获取到视觉手册
    const visualManual = await u.getArtPrompt(project.artStyle as string, "art_skills", config.visualManual);
    if (!visualManual) return res.status(500).send(error("视觉手册未定义"));
    const systemPrompt = `${visualManual}

你正在生成资产中心保存的“资产描述词”，不是最终生图请求。只输出资产本身的稳定视觉描述，不要输出冲突优先级、项目事实源、视觉手册原文、JSON 或 Markdown 标题。`;
    try {
      const factBundle = await loadProjectFactBundle({ projectId, assetId: assetsId });
      const factBundlePrompt = formatProjectFactBundleForPrompt(factBundle, { assetId: assetsId, includeProject: true, maxAssets: 4 });
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
- ${config.nameLabel}名称:${name}
- ${config.nameLabel}描述:${describe}

请只输出一段可保存到资产中心的资产描述词。`,
          },
        ],
      })) as any;

      if (!_output) return res.status(500).send("失败");
      const sourcePrompt = normalizeAssetSourcePrompt(_output, describe || name);
      await u.db("o_assets").where("id", assetsId).update({ prompt: sourcePrompt, promptState: "已完成" });

      if (responsePromptMode === "final") {
        try {
          const { finalPrompt } = await buildFinalAssetImagePrompt({
            projectId,
            assetId: assetsId,
            type: type as AssetImageType,
            name,
            prompt: sourcePrompt,
            describe,
            skillId,
            userRequirement,
          });
          return res.status(200).send(success({ prompt: finalPrompt, sourcePrompt, assetsId }));
        } catch {
          return res.status(200).send(success({ prompt: sourcePrompt, sourcePrompt, assetsId }));
        }
      }

      res.status(200).send(success({ prompt: sourcePrompt, sourcePrompt, assetsId }));
    } catch (e: any) {
      await u
        .db("o_assets")
        .where("id", assetsId)
        .update({ promptState: "失败", promptErrorReason: u.error(e).message });
      return res.status(500).send(error(e?.data?.error?.message ?? e?.message ?? "生成失败"));
    }
  },
);
