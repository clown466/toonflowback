import express from "express";
import u from "@/utils";
import * as zod from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import {
  getVisualManualForAssetType,
  ImageGenerationAssetType,
  renderImageGenerationSkillPrompt,
  resolveImageGenerationSkill,
} from "@/services/imageGenerationSkill";
import { buildNeutralAssetLightingText, inferTimeEnvironment } from "@/services/timeEnvironmentInference";
import { stripThink } from "@/utils/stripThink";
const router = express.Router();


type ItemType = "characters" | "props" | "scenes";

function normalizeAssetType(type: string): ImageGenerationAssetType | null {
  if (type === "role" || type === "scene" || type === "tool") return type;
  if (type === "props") return "tool";
  return null;
}

function getTextOutput(result: any) {
  return stripThink(String(result?._output || result?.text || "")).trim();
}

function buildSkillPromptPolishSystem(visualManual: string, skillPrompt: string) {
  return [
    "你是 Toonflow 的资产生图提示词推理器。",
    "用户会选择一个资产生图预设。请根据该预设、视觉手册、项目设定和资产描述，生成最终可直接发送给图片模型的提示词。",
    "如果现有生图提示词与所选预设冲突，必须以所选预设为最高优先级，重写冲突部分。",
    "例如选择俯视/鸟瞰/overhead 预设时，不要输出 eye-level、cinematic establishing、front view、exterior perspective 等非俯视构图。",
    "只输出最终生图提示词，不要解释，不要 markdown，不要 JSON。",
    "提示词要简洁、明确、可执行；不要堆叠无关规则。",
    "",
    "视觉手册：",
    visualManual || "当前项目未配置对应视觉手册。",
    "",
    "用户选择的资产生图预设：",
    skillPrompt,
  ].join("\n");
}

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
    currentPrompt: zod.string().optional().nullable(),
  }),
  async (req, res) => {
    const { assetsId, projectId, type, name, describe, skillId, userRequirement, currentPrompt } = req.body;
    //获取风格
    const project = await u.db("o_project").where("id", projectId).select("id", "name", "artStyle", "type", "intro", "directorManual").first();
    //如果没有找到对应的项目，返回错误
    if (!project) return res.status(500).send(success({ message: "项目为空" }));

    await u.db("o_assets").where("id", assetsId).update({ promptState: "生成中" });

    //查询资产是否是衍生资产
    const assetsData = await u.db("o_assets").where("id", assetsId).select("assetsId", "prompt").first();
    if (!assetsData) return { code: 500, message: "资产不存在" };
    const assetType = normalizeAssetType(type);
    if (!assetType) return res.status(500).send(error("不支持的类型"));
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

    const config = typeConfig[assetType];
    if (!config) return res.status(500).send(error("不支持的类型"));
    if (!config.visualManual) return res.status(500).send(error("视觉手册未定义"));
    //获取到视觉手册
    const visualManual = await u.getArtPrompt(project.artStyle as string, "art_skills", config.visualManual);
    if (!visualManual) return res.status(500).send(error("视觉手册未定义"));
    try {
      const selectedSkill = await resolveImageGenerationSkill({
        skillId,
        requestText: userRequirement,
        assetType,
      });
      const existingPrompt = String(currentPrompt || assetsData.prompt || "").trim();
      const neutralAssetLighting = assetType === "scene" ? null : buildNeutralAssetLightingText(assetType);
      const timeEnvironmentContext =
        assetType === "scene"
          ? inferTimeEnvironment({
              project: {
                id: projectId,
                name: project.name,
                intro: project.intro,
                type: project.type,
                artStyle: project.artStyle,
              },
              asset: {
                id: assetsId,
                type: assetType,
                name,
                describe,
              },
              userRequirement,
            }).contextText
          : null;
      const skillPrompt = selectedSkill
        ? renderImageGenerationSkillPrompt(selectedSkill, {
            project: {
              id: projectId,
              name: project.name,
              intro: project.intro,
              type: project.type,
              artStyle: project.artStyle,
              directorManual: project.directorManual,
            },
            asset: {
              id: assetsId,
              type: assetType,
              name,
              describe,
              prompt: existingPrompt || describe,
            },
            visualManual: getVisualManualForAssetType(project.artStyle, assetType, !!assetsData.assetsId) || visualManual,
            userRequirement,
            timeEnvironmentContext,
            neutralAssetLighting,
          })
        : "";
      const systemPrompt = selectedSkill ? buildSkillPromptPolishSystem(visualManual, skillPrompt) : visualManual;
      const aiResult = await u.Ai.Text("universalAi").invoke({
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `**基础参数：**
      - 项目名称:${project.name || "未指定"},
      - 项目类型:${project.type || "未指定"},
      - 项目简介:${project.intro || "无"},
      - 选择的生图预设:${selectedSkill ? `${selectedSkill.name} (${selectedSkill.id})` : "默认视觉手册标准生图"},
      **${config.nameLabel}设定：**
      - ${config.nameLabel}名称:${name},
      - ${config.nameLabel}描述:${describe},
      - 现有生图提示词:${existingPrompt || "无"},
      - 用户额外要求:${userRequirement || "无"},
      - 时间环境推理:${timeEnvironmentContext || "无"},
      - 标准展示光约束:${neutralAssetLighting || "无"},`,
          },
        ],
      });
      const _output = getTextOutput(aiResult);

      if (!_output) return res.status(500).send("失败");
      await u.db("o_assets").where("id", assetsId).update({ prompt: _output, promptState: "已完成" });

      res.status(200).send(success({ prompt: _output, assetsId }));
    } catch (e: any) {
      await u
        .db("o_assets")
        .where("id", assetsId)
        .update({ promptState: "失败", promptErrorReason: u.error(e).message });
      return res.status(500).send(error(e?.data?.error?.message ?? e?.message ?? "生成失败"));
    }
  },
);
