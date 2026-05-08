import { Socket } from "socket.io";
import { tool } from "ai";
import { z } from "zod";
import u from "@/utils";
import Memory from "@/utils/agent/memory";
import { getSkillContentForAgent } from "@/utils/agent/skillsTools";
import useTools, { useNovelWorkflowTools } from "@/agents/workspaceAgent/tools";
import {
  getWorkspaceDomainAgentCatalog,
  getWorkspaceSkillCatalog,
  WORKSPACE_DOMAIN_AGENT_IDS,
  WorkspaceDomainAgentId,
} from "@/agents/workspaceAgent/orchestrationRegistry";
import { toPublicWorkspaceName } from "@/services/storyboardDraftGeneration";
import ResTool from "@/socket/resTool";
import { toToolJsonSchema } from "@/utils/jsonSchema";
import * as fs from "fs";
import path from "path";

export interface AgentContext {
  socket: Socket;
  isolationKey: string;
  text: string;
  userMessageTime?: number;
  abortSignal?: AbortSignal;
  resTool: ResTool;
  msg: ReturnType<ResTool["newMessage"]>;
  messages?: { role: "user" | "assistant" | "system"; content: string }[];
  thinkConfig: {
    think: boolean;
    thinlLevel: 0 | 1 | 2 | 3;
  };
}

function buildMemPrompt(mem: Awaited<ReturnType<Memory["get"]>>): string {
  let memoryContext = "";
  if (mem.rag.length) {
    memoryContext += `[相关记忆]\n${mem.rag.map((r) => r.content).join("\n")}`;
  }
  if (mem.summaries.length) {
    if (memoryContext) memoryContext += "\n\n";
    memoryContext += `[历史摘要]\n${mem.summaries.map((s, i) => `${i + 1}. ${s.content}`).join("\n")}`;
  }
  if (mem.shortTerm.length) {
    if (memoryContext) memoryContext += "\n\n";
    memoryContext += `[近期对话]\n${mem.shortTerm.map((m) => `${m.role}: ${m.content}`).join("\n")}`;
  }
  return `## Memory\n以下是你对用户的记忆，可作为参考但不要主动提及：\n${memoryContext}`;
}

function pickCount(value: unknown): number {
  const raw = typeof value === "object" && value !== null ? Object.values(value as Record<string, unknown>)[0] : value;
  const count = Number(raw ?? 0);
  return Number.isFinite(count) ? count : 0;
}

function summarizeAssetRows(rows: Array<{ type?: string | null; count?: unknown }>) {
  const summary = { role: 0, scene: 0, tool: 0, other: 0 };
  for (const row of rows) {
    const type = row.type === "role" || row.type === "scene" || row.type === "tool" ? row.type : "other";
    summary[type] += pickCount(row.count);
  }
  return summary;
}

export async function runDecisionAI(ctx: AgentContext) {
  const { isolationKey, text, userMessageTime, abortSignal, resTool } = ctx;

  const memory = new Memory("workspaceAgent", isolationKey);
  await memory.add("user", text, { createTime: userMessageTime });

  const skill = path.join(u.getPath("skills"), "workspace_agent_decision.md");
  const prompt = getSkillContentForAgent(await fs.promises.readFile(skill, "utf-8"), "workspaceAgent:decisionAgent");

  const projectId = resTool.data.projectId;
  const [projectData, novels, assetRows, workspaceRows] = await Promise.all([
    u.db("o_project").where("id", projectId).first(),
    u.db("o_novel").where("projectId", projectId).select("id", "chapter", "chapterIndex", "eventState", "event", "chapterData").orderBy("chapterIndex", "asc"),
    u.db("o_assets").where("projectId", projectId).whereNull("assetsId").select("type").count({ count: "id" }).groupBy("type"),
    u.db("o_script").where("projectId", projectId).select("id", "name", "content", "extractState", "createTime").orderBy("id", "asc"),
  ]);

  const novelContents = new Map((novels as any[]).map((novel) => [String(novel.chapterData ?? "").trim(), novel]));
  const workspaceSummaries = (workspaceRows as any[]).map((workspace) => {
    const matchedNovel = novelContents.get(String(workspace.content ?? "").trim());
    return {
      id: workspace.id,
      name: toPublicWorkspaceName(workspace.name ?? "未命名分镜工作区"),
      extractState: workspace.extractState,
      matchedNovelChapter: matchedNovel ? `第${matchedNovel.chapterIndex}章 ${matchedNovel.chapter ?? ""}`.trim() : null,
    };
  });
  const assetSummary = summarizeAssetRows(assetRows as Array<{ type?: string | null; count?: unknown }>);
  const completedNovelCount = (novels as any[]).filter((novel) => novel.eventState === 1).length;

  const mem = buildMemPrompt(await memory.get(text));
  const importedChapterEpisodeHint =
    (novels as any[]).length > workspaceSummaries.length
      ? `按当前导入形态，应优先按小说章节规划集数：${(novels as any[]).length} 章≈${(novels as any[]).length} 集；内部章节工作区只有 ${workspaceSummaries.length} 条记录，不代表项目只有 ${workspaceSummaries.length} 集。`
      : "";
  const projectInfo = [
    "## 当前数据库项目级上下文（最高优先级）",
    "注意：如果 Memory/历史摘要里的工作区数、资产数、章节状态和本段冲突，必须以本段实时数据库状态为准。",
    "产品路径固定为：小说 -> 资产 -> 分镜表 -> 分镜图 -> 视频。当前项目不使用“改编剧本”步骤，不要建议用户生成、确认或管理改编剧本。",
    `projectId：${projectId}`,
    `项目名称：${projectData?.name ?? "未知"}`,
    `小说类型：${projectData?.type ?? "未知"}`,
    `小说简介：${projectData?.intro ?? "无"}`,
    `目标画风：${projectData?.artStyle ?? "无"}`,
    `导演手册：${projectData?.directorManual ?? "无"}`,
    `视频画幅：${projectData?.videoRatio ?? "16:9"}`,
    `小说导入条目数：${(novels as any[]).length}，事件分析完成：${completedNovelCount}/${(novels as any[]).length}`,
    `导入条目列表：${(novels as any[]).map((novel) => `${novel.id}:项目内第${novel.chapterIndex}条（原始名：${novel.chapter ?? ""}）eventState=${novel.eventState}`).join("；") || "无"}`,
    "章节称呼规则：不要无条件跟随用户口误；若用户说第N章但原始名不是第N章，必须说“项目内第N条/原始名xxx”，不能断言原文有第N章。",
    importedChapterEpisodeHint,
    `项目资产数：${Object.values(assetSummary).reduce((sum, value) => sum + value, 0)}（角色${assetSummary.role}，场景${assetSummary.scene}，道具${assetSummary.tool}，其他${assetSummary.other}）`,
    `内部章节分镜工作区记录数：${workspaceSummaries.length}`,
    `内部章节分镜工作区记录：${workspaceSummaries.map((workspace) => `${workspace.id}:${workspace.name}${workspace.matchedNovelChapter ? `（内容与${workspace.matchedNovelChapter}原文相同，是章节工作区，不是改编剧本）` : ""}`).join("；") || "无"}`,
    "沟通要求：不要把内部 o_script/scriptId/episodesId 说成剧本或生产容器；对用户只说小说章节、资产库、分镜表、分镜图、视频。需要保存分镜时自动创建或复用章节分镜工作区。",
  ].filter(Boolean).join("\n");

  const { fullStream } = await u.Ai.Text("workspaceAgent:decisionAgent", ctx.thinkConfig.think, ctx.thinkConfig.thinlLevel).stream({
    messages: ctx.messages ?? [
      { role: "system", content: prompt },
      { role: "assistant", content: projectInfo + "\n" + mem },
      { role: "user", content: text },
    ],
    abortSignal,
    tools: {
      ...memory.getTools(),
      ...useTools({ resTool: ctx.resTool, msg: ctx.msg, abortSignal: ctx.abortSignal }),
      ...useNovelWorkflowTools({ resTool: ctx.resTool, msg: ctx.msg, abortSignal: ctx.abortSignal }),
      ...(await createSubAgent(ctx)),
    },
    onFinish: async (completion) => {
      await memory.add("assistant:decision", removeAllXmlTags(completion.text));
    },
  });

  let currentMsg = ctx.msg;
  await consumeFullStream(fullStream, currentMsg, () => {
    if (ctx.msg === currentMsg) return currentMsg;
    currentMsg.complete();
    currentMsg = ctx.msg;
    return currentMsg;
  });
}

async function createSubAgent(parentCtx: AgentContext) {
  const { resTool, abortSignal } = parentCtx;
  const memory = new Memory("workspaceAgent", parentCtx.isolationKey);

  async function runAgent({
    key,
    prompt,
    system,
    name,
    memoryKey,
    tools: extraTools,
    messages,
  }: {
    key: `${string}:${string}`;
    prompt: string;
    system: string;
    name: string;
    memoryKey: string;
    tools?: Record<string, any>;
    messages?: { role: "user" | "assistant" | "system"; content: string }[];
  }) {
    parentCtx.msg.complete();
    const subMsg = resTool.newMessage("assistant", name);

    const { fullStream } = await u.Ai.Text(key, parentCtx.thinkConfig.think, parentCtx.thinkConfig.thinlLevel).stream({
      system,
      messages: messages ?? [{ role: "user", content: prompt }],
      abortSignal,
      tools: {
        ...extraTools,
        ...useTools({ resTool, msg: subMsg, abortSignal }),
        ...useNovelWorkflowTools({ resTool, msg: subMsg, abortSignal }),
      },
    });

    const fullResponse = await consumeFullStream(fullStream, subMsg);

    if (fullResponse.trim()) {
      await memory.add(memoryKey, removeAllXmlTags(fullResponse), {
        name,
        createTime: new Date(subMsg.datetime).getTime(),
      });
    }

    parentCtx.msg = resTool.newMessage("assistant", "项目总控");
    return fullResponse;
  }

  const promptInput = toToolJsonSchema<{ prompt: string }>(z.object({
    prompt: z.string().describe("交给子控的项目级任务简约描述，100字以内"),
  }));

  async function delegateProductionAgent(prompt: string) {
    const workspaces = await u.db("o_script").where("projectId", resTool.data.projectId).select("id", "name", "extractState", "createTime");
    const scriptId = resTool.data.scriptId;

    const skill = path.join(u.getPath("skills"), "production_agent_decision.md");
    const systemPrompt = getSkillContentForAgent(await fs.promises.readFile(skill, "utf-8"), "productionAgent:decisionAgent");
    const [projectData, assets] = await Promise.all([
      u.db("o_project").where("id", resTool.data.projectId).first(),
      u
        .db("o_assets")
        .where("projectId", resTool.data.projectId)
        .whereNull("assetsId")
        .select("id", "name", "type", "describe", "prompt")
        .orderBy("id", "asc"),
    ]);

    const productionContext = [
      "## 项目级生产上下文",
      `projectId：${resTool.data.projectId}`,
      `当前章节分镜工作区ID：${scriptId ?? "未指定，必要时由工具按小说章节自动创建或复用"}`,
      `项目名称：${projectData?.name ?? "未知"}`,
      `目标画风：${projectData?.artStyle ?? "无"}`,
      `资产库：${JSON.stringify(assets).slice(0, 12000)}`,
      `已有章节分镜工作区：${workspaces.map((s: any) => `${s.id}:${toPublicWorkspaceName(s.name ?? "未命名分镜工作区")}`).join("，") || "无"}`,
      "本项目不走改编剧本步骤；生产流程必须使用小说章节/事件分析、项目资产库、分镜表、分镜图、视频。",
    ].join("\n");

    return runAgent({
      key: "productionAgent:decisionAgent",
      prompt,
      system: systemPrompt,
      name: "生产总控",
      memoryKey: "assistant:delegation:productionAgent",
      messages: [
        { role: "assistant", content: productionContext },
        { role: "user", content: prompt },
      ],
    });
  }

  async function buildAssetReferencePlan(focus?: string) {
    const assets = await u
      .db("o_assets")
      .leftJoin("o_image", "o_assets.imageId", "o_image.id")
      .where("o_assets.projectId", resTool.data.projectId)
      .whereNull("o_assets.assetsId")
      .select("o_assets.id", "o_assets.name", "o_assets.type", "o_assets.describe", "o_assets.prompt", "o_assets.imageId", "o_image.state as imageState")
      .orderByRaw(`CASE o_assets.type WHEN 'role' THEN 1 WHEN 'scene' THEN 2 WHEN 'tool' THEN 3 ELSE 4 END`)
      .orderBy("o_assets.id", "asc");

    const missingImageAssets = assets.filter((asset: any) => !asset.imageId || asset.imageState === "生成失败");
    const pick = (type: string) => missingImageAssets.filter((asset: any) => asset.type === type).slice(0, 10);
    return {
      projectId: resTool.data.projectId,
      focus: focus ?? null,
      summary: {
        totalAssets: assets.length,
        missingImageAssets: missingImageAssets.length,
      },
      plan: {
        roleFourViews: pick("role").map((asset: any) => ({ assetId: asset.id, name: asset.name, reason: "角色缺少可用参考图，优先规划四视图。" })),
        sceneReferences: pick("scene").map((asset: any) => ({ assetId: asset.id, name: asset.name, reason: "场景缺少可用参考图，优先规划环境参考。" })),
        propReferences: pick("tool").map((asset: any) => ({ assetId: asset.id, name: asset.name, reason: "道具缺少可用参考图，优先规划单体参考。" })),
      },
      nextStep: "如需实际生成图片，请先确认范围，再交给现有资产生成/生产流程执行。",
    };
  }

  async function delegateDomainAgent(agentId: WorkspaceDomainAgentId, prompt: string) {
    if (agentId === "production") return delegateProductionAgent(prompt);
    return buildAssetReferencePlan(prompt);
  }

  const list_available_agents = tool({
    description: "列出 Flova 可转交的领域子控目录。总控做路由决策前优先调用。",
    inputSchema: toToolJsonSchema<Record<string, never>>(z.object({})),
    execute: async () => ({
      projectId: resTool.data.projectId,
      agents: getWorkspaceDomainAgentCatalog(),
      routingRule: "Flova 先判断用户意图；只转交领域子控，不直接暴露叶子子 Agent。",
    }),
  });

  const list_available_skills = tool({
    description: "列出当前项目可用的 skills 目录；只用于选择路线和说明能力，不直接激活所有技能。",
    inputSchema: toToolJsonSchema<Record<string, never>>(z.object({})),
    execute: async () => ({
      projectId: resTool.data.projectId,
      skills: await getWorkspaceSkillCatalog(Number(resTool.data.projectId)),
    }),
  });

  const delegate_agent = tool({
    description: "统一转交给领域子控。优先使用这个工具，而不是直接调用具体旧工具；叶子子 Agent 和 skills 由领域子控自行调度。",
    inputSchema: toToolJsonSchema<{ agentId: WorkspaceDomainAgentId; prompt: string }>(z.object({
      agentId: z.enum(WORKSPACE_DOMAIN_AGENT_IDS).describe("要转交的领域子控"),
      prompt: z.string().describe("交给领域子控的项目级任务描述，100字以内"),
    })),
    execute: async ({ agentId, prompt }) => delegateDomainAgent(agentId, prompt),
  });

  const run_production_agent_for_assets = tool({
    description: "兼容旧提示词：项目级资产/生产转交工具。新流程优先调用 delegate_agent(agentId='production')。",
    inputSchema: promptInput,
    execute: async ({ prompt }) => delegateProductionAgent(prompt),
  });

  const run_asset_reference_generation_plan = tool({
    description: "兼容旧提示词：基于项目级资产库规划参考图。新流程优先调用 delegate_agent(agentId='asset_reference_planner')。",
    inputSchema: toToolJsonSchema<{ focus?: string }>(z.object({
      focus: z.string().optional().describe("可选：计划关注点，例如优先主角、重点场景、缺图资产等"),
    })),
    execute: async ({ focus }) => buildAssetReferencePlan(focus),
  });

  return {
    list_available_agents,
    list_available_skills,
    delegate_agent,
    run_production_agent_for_assets,
    run_asset_reference_generation_plan,
  };
}

async function consumeFullStream(
  fullStream: AsyncIterable<any>,
  initialMsg: ReturnType<ResTool["newMessage"]>,
  syncMsg?: () => ReturnType<ResTool["newMessage"]>,
): Promise<string> {
  let msg = initialMsg;
  let text = msg.text();
  let thinking: ReturnType<typeof msg.thinking> | null = null;
  let thinkTime = 0;
  let fullResponse = "";

  try {
    for await (const chunk of fullStream) {
      await new Promise<void>((resolve) => setTimeout(() => resolve(), 1));
      if (syncMsg) {
        const newMsg = syncMsg();
        if (newMsg !== msg) {
          msg = newMsg;
          text = msg.text();
        }
      }
      if (chunk.type === "reasoning-start") {
        thinkTime = Date.now();
        thinking = msg.thinking("思考中...");
      } else if (chunk.type === "reasoning-delta") {
        thinking?.append(chunk.text);
      } else if (chunk.type === "reasoning-end") {
        thinkTime = Date.now() - thinkTime;
        thinking?.updateTitle(`思考完毕（${(thinkTime / 1000).toFixed(1)} 秒）`);
        thinking?.complete();
        thinking = null;
      } else if (chunk.type === "text-delta") {
        text.append(chunk.text);
        fullResponse += chunk.text;
      } else if (chunk.type === "error") {
        throw chunk.error;
      }
    }
    text.complete();
    msg.complete();
  } catch (err: any) {
    thinking?.complete();
    const errMsg = err?.message ?? String(err);
    text.append(errMsg);
    text.error();
    msg.error(errMsg);
    err.__workspaceAgentReported = true;
    throw err;
  }

  return fullResponse;
}

function removeAllXmlTags(text: string): string {
  text = text.replace(/<([a-zA-Z][\w-]*)(\s+[^>]*)?>([\s\S]*?)<\/\1>/g, "");
  text = text.replace(/<([a-zA-Z][\w-]*)(\s+[^>]*)?\/>/g, "");
  text = text.replace(/<\/?[a-zA-Z][\w-]*(\s+[^>]*)?>/g, "");
  return text.trim();
}
