import { tool, Tool } from "ai";
import { z } from "zod";
import _ from "lodash";
import ResTool from "@/socket/resTool";
import u from "@/utils";
import { toToolJsonSchema } from "@/utils/jsonSchema";
import { shouldAppend, shouldForce } from "@/services/storyboardDraftGeneration";
import { generateProjectStoryboardWithSkill } from "@/services/storyboardSkillGeneration";

const deriveAssetSchema = z.object({
  id: z.number().describe("衍生资产ID,如果新增则为空"),
  assetsId: z.number().describe("关联的资产ID"),
  prompt: z.string().describe("生成提示词"),
  name: z.string().describe("衍生资产名称"),
  desc: z.string().describe("衍生资产描述"),
  src: z.string().nullable().describe("衍生资产资源路径"),
  state: z.enum(["未生成", "生成中", "已完成", "生成失败"]).describe("衍生资产生成状态"),
  type: z.enum(["role", "tool", "scene", "clip"]).describe("衍生资产类型"),
});
export const assetItemSchema = z.object({
  id: z.number().describe("资产唯一标识"),
  name: z.string().describe("资产名称"),
  type: z.enum(["role", "tool", "scene", "clip"]).describe("资产类型"),
  prompt: z.string().describe("生成提示词"),
  desc: z.string().describe("资产描述"),
  derive: z.array(deriveAssetSchema).describe("衍生资产列表"),
});
const storyboardSchema = z.object({
  id: z.number().describe("分镜ID，必须为真实id"),
  duration: z.number().describe("持续时长(秒)"),
  prompt: z.string().describe("生成提示词"),
  associateAssetsIds: z.array(z.number()).describe("关联资产ID列表"),
  src: z.string().nullable().describe("分镜资源路径"),
  index: z.number().nullable().optional().describe("分镜排序字段"),
});
const workbenchDataSchema = z.object({
  name: z.string().describe("项目名称"),
  duration: z.string().describe("视频时长"),
  resolution: z.string().describe("分辨率"),
  fps: z.string().describe("帧率"),
  cover: z.string().optional().describe("封面图片路径"),
  gradient: z.string().optional().describe("渐变色配置"),
});
const posterItemSchema = z.object({
  id: z.number().describe("海报ID"),
  image: z.string().describe("海报图片路径"),
});
export const flowDataSchema = z.object({
  script: z.string().describe("章节内容"),
  scriptPlan: z.string().describe("导演规划"),
  assets: z.array(assetItemSchema).describe("资产库"),
  storyboardTable: z.string().describe("分镜表"),
  storyboard: z.array(storyboardSchema).describe("分镜面板"),
});

export type FlowData = z.infer<typeof flowDataSchema>;

const keySchema = z.enum(Object.keys(flowDataSchema.shape) as [keyof FlowData, ...Array<keyof FlowData>]);
const flowDataKeyLabels = Object.fromEntries(
  Object.entries(flowDataSchema.shape).map(([key, schema]) => [key, (schema as z.ZodTypeAny).description ?? key]),
) as Record<keyof FlowData, string>;

interface ToolConfig {
  resTool: ResTool;
  toolsNames?: string[];
  msg: ReturnType<ResTool["newMessage"]>;
}

export default (toolCpnfig: ToolConfig) => {
  const { resTool, toolsNames, msg } = toolCpnfig;
  const { socket } = resTool;

  const createProjectStoryboardsTool = (defaultForce: boolean, description: string) => tool({
    description,
    inputSchema: toToolJsonSchema<{
      sourceText?: string;
      novelIds?: number[];
      chapterIndexes?: number[];
      skillId?: string;
      userRequirement?: string;
      force?: boolean;
      append?: boolean;
    }>(z.object({
      sourceText: z.string().optional().describe("用户原始要求；必须尽量完整保留章节、jubenN、时长、风格、对白承载等约束"),
      novelIds: z.array(z.number()).optional().describe("可选：只处理指定小说章节 ID"),
      chapterIndexes: z.array(z.number()).optional().describe("可选：只处理指定项目内章节序号，例如 juben17 传 17"),
      skillId: z.string().optional().describe("可选：使用指定分镜 Skill"),
      userRequirement: z.string().optional().describe("用户额外分镜要求"),
      force: z.boolean().optional().describe("是否覆盖旧分镜；重新推理/再次推理/重推时默认为 true"),
      append: z.boolean().optional().describe("是否追加；默认 false"),
    })),
    execute: async (options) => {
      const projectId = Number(resTool.data.projectId);
      const sourceText = [options.sourceText, options.userRequirement].filter(Boolean).join("\n");
      const thinking = msg.thinking("正在生成生产分镜草案...");
      thinking.updateTitle("正在调用分镜模型生成结构化分镜...");
      const result = await generateProjectStoryboardWithSkill(projectId, {
        sourceText,
        userRequirement: options.userRequirement,
        skillId: options.skillId,
        preferredScriptId: typeof resTool.data.scriptId === "number" ? resTool.data.scriptId : undefined,
        force: options.force ?? (defaultForce || shouldForce(sourceText)),
        append: options.append ?? shouldAppend(sourceText),
        novelIds: options.novelIds,
        chapterIndexes: options.chapterIndexes,
        onWorkspaceResolved: (workspace) => {
          socket.emit("productionDataUpdated", {
            projectId,
            episodesId: workspace.episodesId,
            scriptName: workspace.scriptName,
            scriptCreated: workspace.scriptCreated,
            existingCount: workspace.existingCount,
            selectedNovelIds: workspace.selectedNovelIds,
            selectedChapterIndexes: workspace.selectedChapterIndexes,
            selectedChapterLabels: workspace.selectedChapterLabels,
            createdCount: 0,
            storyboardIds: [],
            stage: "workspace_resolved",
          });
        },
      });
      socket.emit("productionDataUpdated", {
        projectId,
        episodesId: result.episodesId,
        scriptName: result.scriptName,
        scriptCreated: result.scriptCreated,
        existingCount: result.existingCount,
        replaced: result.replaced,
        appended: result.appended,
        createdCount: result.createdCount,
        storyboardIds: result.storyboardIds,
        selectedNovelIds: result.selectedNovelIds,
        selectedChapterIndexes: result.selectedChapterIndexes,
        selectedChapterLabels: result.selectedChapterLabels,
        stage: result.reviewStatus === "failed" ? "storyboard_review_failed" : "storyboard_generated",
      });
      thinking.appendText(JSON.stringify({
        projectId,
        episodesId: result.episodesId,
        scriptName: result.scriptName,
        createdCount: result.createdCount,
        existingCount: result.existingCount,
        replaced: result.replaced,
        appended: result.appended,
        selectedChapterIndexes: result.selectedChapterIndexes,
        usedSkillId: result.usedSkillId,
        usedSkillName: result.usedSkillName,
        fallbackReason: result.fallbackReason,
        reviewStatus: result.reviewStatus,
        reviewWarnings: result.reviewWarnings,
        reviewFailures: result.reviewFailures,
      }, null, 2));
      thinking.updateTitle(result.reviewStatus === "failed" ? "分镜候选未通过审核，等待确认" : result.createdCount > 0 ? "分镜草案已写入章节工作区" : "已有分镜，已切换章节工作区");
      thinking.complete();
      return {
        ok: true,
        ...result,
        message: `${result.message}${shouldForce(sourceText) ? " 已按覆盖重推语义处理。" : ""}`,
      };
    },
  });
  const regenerateProjectStoryboardsTool = createProjectStoryboardsTool(
    true,
    "可靠覆盖重推项目章节分镜表；模型输出通过审核后写回分镜面板，审核不通过时必须把审核结论交给用户确认是否重推。用户要求删除旧分镜、覆盖重推、重新推理、再次推理分镜时优先使用；不要用旧 XML 子 Agent 自己拼写。",
  );
  const generateProjectStoryboardsTool = createProjectStoryboardsTool(
    false,
    "按小说章节/事件分析生成章节分镜表；模型输出通过审核后写回分镜面板，审核不通过时必须把审核结论交给用户确认是否重推。用户要求做分镜、生成分镜表时使用；重新推理/重推/覆盖时请使用 regenerate_project_storyboards。",
  );

  const generateStoryboardTool = tool({
    description: "生成分镜图片",
    inputSchema: toToolJsonSchema<{ ids: number[] }>(z.object({
      ids: z.array(z.number()).describe("必须获取真实的分镜ID，支持批量生成"),
    })),
    execute: async ({ ids }) => {
      const thinking = msg.thinking("正在生成分镜...");
      new Promise((resolve) => socket.emit("generateStoryboard", { ids }, (res: any) => resolve(res)))
        .then((res) => {
          thinking.appendText("生成的分镜数据:\n" + JSON.stringify(res, null, 2));
          thinking.updateTitle("分镜生成完成");
          thinking.complete();
        })
        .catch((e) => {
          thinking.appendText("分镜生成失败:\n" + u.error(e).message);
          thinking.updateTitle("分镜生成失败");
          thinking.complete();
        });

      return "开始生成分镜";
    },
  });

  const tools: Record<string, Tool> = {
    get_flowData: tool({
      description: "获取工作区数据",
      inputSchema: toToolJsonSchema<{ key: keyof FlowData }>(z.object({
        key: keySchema.describe("数据key"),
      })),
      execute: async ({ key }) => {
        const thinking = msg.thinking(`正在获取${flowDataKeyLabels[key]}工作区数据...`);
        console.log("[tools] get_flowData", key);
        const flowData: FlowData = await new Promise((resolve) => socket.emit("getFlowData", { key }, (res: any) => resolve(res)));
        thinking.appendText(`获取到${flowDataKeyLabels[key]}:\n` + JSON.stringify(flowData[key], null, 2));
        thinking.updateTitle(`获取${flowDataKeyLabels[key]}完成`);
        thinking.complete();
        return flowData[key];
      },
    }),
    add_deriveAsset: tool({
      description: "新增或更新衍生资产",
      inputSchema: toToolJsonSchema<{ assetsId: number; id: number | null; name: string; desc: string }>(z.object({
        assetsId: z.number().describe("关联的资产ID"),
        id: z.number().nullable().describe("衍生资产ID,如果新增则为空"),
        name: z.string().describe("衍生资产名称"),
        desc: z.string().describe("衍生资产描述"),
      })),
      execute: async (raw) => {
        const idRaw = raw.id as unknown;
        const normalizedId = idRaw === "null" || idRaw === "" || idRaw === undefined ? null : (idRaw as number | null);
        const deriveAsset = { ...raw, id: normalizedId };

        const thinking = msg.thinking("正在操作资产...");
        const { projectId, scriptId } = resTool.data;
        const startTime = Date.now();
        const parentAssets = await u.db("o_assets").where("id", deriveAsset.assetsId).select("id", "type").first();
        if (!parentAssets) return "关联的资产不存在";

        const data = {
          id: deriveAsset.id ?? undefined,
          assetsId: deriveAsset.assetsId,
          projectId,
          name: deriveAsset.name,
          type: parentAssets.type,
          describe: deriveAsset.desc,
          startTime,
        };
        if (deriveAsset.id) {
          await u.db("o_assets").where("id", deriveAsset.id).update(data);
          thinking.appendText(`已更新衍生资产，ID: ${deriveAsset.id}\n`);
        } else {
          const [insertedId] = await u.db("o_assets").insert(data);
          data.id = insertedId;
          await u.db("o_scriptAssets").insert({ scriptId, assetId: insertedId });
          thinking.appendText(`已新增衍生资产，ID: ${insertedId}\n`);
        }
        const res = await new Promise((resolve) => socket.emit("addDeriveAsset", data, (res: any) => resolve(res)));
        thinking.updateTitle("资产操作完成");
        thinking.complete();
        return res ?? "操作成功";
      },
    }),
    del_deriveAsset: tool({
      description: "删除衍生资产",
      inputSchema: toToolJsonSchema<{ assetsId: number; id: number }>(z.object({
        assetsId: z.number().describe("关联的资产ID"),
        id: z.number().describe("衍生资产ID"),
      })),
      execute: async ({ assetsId, id }) => {
        const thinking = msg.thinking("正在操作资产...");
        const { scriptId } = resTool.data;
        await u.db("o_assets").where("id", id).del();
        await u.db("o_scriptAssets").where({ scriptId, assetId: id }).del();
        thinking.appendText(`已删除衍生资产，ID: ${id}\n`);
        const res = await new Promise((resolve) => socket.emit("delDeriveAsset", { assetsId, id }, (res: any) => resolve(res)));
        thinking.updateTitle("资产操作完成");
        thinking.complete();
        return res ?? "删除成功";
      },
    }),
    generate_deriveAsset: tool({
      description: "生成衍生资产图片",
      inputSchema: toToolJsonSchema<{ ids: number[] }>(z.object({
        ids: z.array(z.number()).describe("需要生成的 衍生资产ID"),
      })),
      execute: async ({ ids }) => {
        const thinking = msg.thinking("正在生成衍生资产...");
        new Promise((resolve) => socket.emit("generateDeriveAsset", { ids }, (res: any) => resolve(res)))
          .then((res) => {
            thinking.appendText(`已生成衍生资产，ID: ${JSON.stringify(res, null, 2)}\n`);
            thinking.updateTitle("衍生资产开始完成");
            thinking.complete();
          })
          .catch((e) => {
            thinking.appendText("衍生资产生成失败:\n" + u.error(e).message);
            thinking.updateTitle("衍生资产生成失败");
            thinking.complete();
          });

        return "开始生成衍生资产";
      },
    }),
    generate_storyboard: generateStoryboardTool,
    generate_storyboard_images: generateStoryboardTool,
    regenerate_project_storyboards: regenerateProjectStoryboardsTool,
    generate_project_storyboard_draft: generateProjectStoryboardsTool,
  };

  return toolsNames ? Object.fromEntries(Object.entries(tools).filter(([n]) => toolsNames.includes(n))) : tools;
};
