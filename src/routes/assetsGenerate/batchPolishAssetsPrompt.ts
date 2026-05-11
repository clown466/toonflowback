import express from "express";
import u from "@/utils";
import pLimit from "p-limit";
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

function normalizeAssetType(type: string): ImageGenerationAssetType | null {
  if (type === "role" || type === "scene" || type === "tool") return type;
  if (type === "props") return "tool";
  return null;
}

function getTextOutput(result: any) {
  return stripThink(String(result?._output || result?.text || "")).trim();
}

function buildRoleIdentityGuard(assetType: ImageGenerationAssetType) {
  if (assetType !== "role") return "";
  return [
    "角色身份硬规则：",
    "1. 如果角色描述、现有提示词、项目设定或视觉手册提到水果、果、fruit，最终提示词必须在开头明确一个具体水果原型。",
    "2. 禁止只写“拟人化水果”“变异水果”“水果角色”“fruit character”“mutated fruit”；必须写成“拟人化青梨角色”“anthropomorphic green pear character”这类具体身份。",
    "3. 如果原文没有明确水果种类，必须根据角色名称、颜色、轮廓、剧情职能和已有描述选择一个最合理的单一水果原型；不要混合多个水果。",
    "4. 不要用固定水果负面约束来防误识别，例如不要写“不要草莓、不要柠檬”；正确做法是正向写清楚具体水果原型。",
  ].join("\n");
}

function buildSkillPromptPolishSystem(visualManual: string, skillPrompt: string, assetType: ImageGenerationAssetType) {
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
    buildRoleIdentityGuard(assetType),
    "",
    "用户选择的资产生图预设：",
    skillPrompt,
  ].join("\n");
}

function buildDefaultPromptPolishSystem(visualManual: string, assetType: ImageGenerationAssetType) {
  return [visualManual, buildRoleIdentityGuard(assetType)].filter(Boolean).join("\n\n");
}

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
        skillId: zod.string().optional().nullable(),
        userRequirement: zod.string().optional().nullable(),
      }),
    ),
    projectId: zod.number(),
    concurrentCount: zod.number().int().min(1).optional(),
    skillId: zod.string().optional().nullable(),
    userRequirement: zod.string().optional().nullable(),
    otherTextPrompt: zod.string().optional().nullable(),
  }),
  async (req, res) => {
    const { projectId, items, concurrentCount, skillId, userRequirement, otherTextPrompt } = req.body;
    //获取风格
    const project = await u.db("o_project").where("id", projectId).select("id", "name", "artStyle", "type", "intro", "directorManual").first();
    //如果没有找到对应的项目，返回错误
    if (!project) return res.status(500).send(success({ message: "项目为空" }));

    // 预加载公共数据
    const assetsIds = items.map((item: { assetsId: number }) => item.assetsId);
    //查询所有资产，用于判断每个资产是否是衍生资产
    const assetsDataList = await u.db("o_assets").whereIn("id", assetsIds).select("id", "assetsId", "prompt");
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
    const tasks = items.map((item: { assetsId: number; type: string; name: string; describe: string; skillId?: string | null; userRequirement?: string | null }) =>
      limit(async () => {
        const assetData = assetsDataMap.get(item.assetsId);
        if (!assetData) return;
        const assetType = normalizeAssetType(item.type);
        if (!assetType) return;
        const typeConfig = getTypeConfig(!!assetData.assetsId);
        const config = typeConfig[assetType];
        if (!config) return;
        //获取到视觉手册
        const visualManual = await u.getArtPrompt(project.artStyle as string, "art_skills", config.visualManual);
        if (!visualManual) {
          await u.db("o_assets").where("id", item.assetsId).update({ promptState: "生成失败", promptErrorReason: "视觉手册未定义" });
          return;
        }
        try {
          const effectiveUserRequirement = item.userRequirement ?? userRequirement ?? otherTextPrompt ?? null;
          const existingPrompt = String(assetData.prompt || "").trim();
          const selectedSkill = await resolveImageGenerationSkill({
            skillId: item.skillId ?? skillId,
            requestText: effectiveUserRequirement,
            assetType,
          });
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
                    id: item.assetsId,
                    type: assetType,
                    name: item.name,
                    describe: item.describe,
                  },
                  userRequirement: effectiveUserRequirement,
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
                  id: item.assetsId,
                  type: assetType,
                  name: item.name,
                  describe: item.describe,
                  prompt: existingPrompt || item.describe,
                },
                visualManual: getVisualManualForAssetType(project.artStyle, assetType, !!assetData.assetsId) || visualManual,
                userRequirement: effectiveUserRequirement,
                timeEnvironmentContext,
                neutralAssetLighting,
              })
            : "";
          const systemPrompt = selectedSkill
            ? buildSkillPromptPolishSystem(visualManual, skillPrompt, assetType)
            : buildDefaultPromptPolishSystem(visualManual, assetType);
          const aiResult = await u.Ai.Text("universalAi").invoke({
            system: systemPrompt,
            messages: [
              {
                role: "user",
                content: `
                    **基础参数：**
      - 项目名称:${project.name || "未指定"},
      - 项目类型:${project.type || "未指定"},
      - 项目简介:${project.intro || "无"},
      - 选择的生图预设:${selectedSkill ? `${selectedSkill.name} (${selectedSkill.id})` : "默认视觉手册标准生图"},
      **${config.nameLabel}设定：**
      - ${config.nameLabel}名称:${item.name},
      - ${config.nameLabel}描述:${item.describe},
      - 现有生图提示词:${existingPrompt || "无"},
      - 用户额外要求:${effectiveUserRequirement || "无"},
      - 时间环境推理:${timeEnvironmentContext || "无"},
      - 标准展示光约束:${neutralAssetLighting || "无"},`,
              },
            ],
          });
          const _output = getTextOutput(aiResult);

          if (!_output) {
            await u.db("o_assets").where("id", item.assetsId).update({ promptState: "生成失败" });
            return;
          }

          await u.db("o_assets").where("id", item.assetsId).update({ prompt: _output, promptState: "已完成" });
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
