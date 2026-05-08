import jwt from "jsonwebtoken";
import u from "@/utils";
import { Namespace, Socket } from "socket.io";
import * as agent from "@/agents/workspaceAgent/index";
import ResTool from "@/socket/resTool";
import Memory from "@/utils/agent/memory";
import { executeWorkspaceCommandPlan } from "@/agents/workspaceAgent/command/executor";
import { createWorkspaceCommandPlan } from "@/agents/workspaceAgent/command/planner";
import { loadProjectSnapshot } from "@/agents/workspaceAgent/command/projectSnapshot";
import type { WorkspaceCommandPlan } from "@/agents/workspaceAgent/command/planner";

type WorkspaceCommandIntent = "storyboard_clear" | "storyboard_generation" | "asset_image_generation" | "asset_extraction";

export function getWorkspaceCommandCandidateIntent(content: string): WorkspaceCommandIntent | null {
  const shouldFastRegenerateStoryboards =
    /(确认|确定|执行|开始)?.{0,8}(删除|删掉|清空|清除|覆盖|重置).{0,12}(重新推理|重推|重新生成|重做|重建)/i.test(content) ||
    /(重新推理|重推).{0,12}(分镜|镜头|storyboard)/i.test(content);
  if (shouldFastRegenerateStoryboards) return "storyboard_generation";

  const shouldFastClearStoryboards =
    /(清空|清除|删除|删掉|移除|重置).{0,12}(分镜|镜头|storyboard)|(分镜|镜头|storyboard).{0,12}(清空|清除|删除|删掉|移除|重置)/i.test(content);
  if (shouldFastClearStoryboards) return "storyboard_clear";

  const shouldFastGenerateStoryboards =
    /(分镜|镜头|storyboard|镜号|shot list)/i.test(content) &&
    /(出|生成|做|创建|规划|拆|整理|帮我|开始|直接|一键|一句话|生产)/i.test(content);
  if (shouldFastGenerateStoryboards) return "storyboard_generation";

  const explicitAssetImageIntent =
    /(资产|角色|场景|道具|参考图).*(出图|生图|生成.*图|批量.*图|图片)|(出图|生图|生成.*图).*(资产|角色|场景|道具|参考图)/i.test(content);
  const genericBatchImageIntent =
    /(批量|全部|所有|统一|帮我|开始|直接).{0,16}(出图|生图|生成.*图)|(出图|生图).{0,16}(批量|全部|所有|统一)/i.test(content) &&
    !/(分镜|镜头|storyboard|视频)/i.test(content);
  if (explicitAssetImageIntent || genericBatchImageIntent) return "asset_image_generation";

  const shouldFastExtractAssets = /提取?资产|提资产|资产库|角色.*场景.*道具|塑角造景|准备资产/i.test(content);
  if (shouldFastExtractAssets) return "asset_extraction";

  return null;
}

function isExecutableWorkspaceCommandPlan(plan: WorkspaceCommandPlan | null | undefined): plan is WorkspaceCommandPlan {
  return Boolean(plan?.intent);
}

function getFastPathMemoryContent(result: any): string | null {
  const message = result?.message ?? result?.result?.message;
  if (typeof message === "string" && message.trim()) return message.trim();
  return null;
}

async function verifyToken(rawToken: string): Promise<Boolean> {
  const setting = await u.db("o_setting").where("key", "tokenKey").select("value").first();
  if (!setting) return false;
  const { value: tokenKey } = setting;
  if (!rawToken) return false;
  const token = rawToken.replace("Bearer ", "");
  try {
    jwt.verify(token, tokenKey as string);
    return true;
  } catch (err) {
    return false;
  }
}

export default (nsp: Namespace) => {
  nsp.on("connection", async (socket: Socket) => {
    const token = socket.handshake.auth.token;
    if (!token || !(await verifyToken(token))) {
      console.log("[workspaceAgent] 连接失败，token无效");
      socket.disconnect();
      return;
    }
    let isolationKey = socket.handshake.auth.isolationKey;
    if (!isolationKey) {
      console.log("[workspaceAgent] 连接失败，缺少 isolationKey");
      socket.disconnect();
      return;
    }

    console.log("[workspaceAgent] 已连接:", socket.id);

    let resTool = new ResTool(socket, {
      projectId: socket.handshake.auth.projectId,
    });
    let abortController: AbortController | null = null;

    const thinkConfig: agent.AgentContext["thinkConfig"] = {
      think: false,
      thinlLevel: 0,
    };

    socket.on("updateContext", (data: { isolationKey: string; projectId: number; scriptId?: number | null }, callback) => {
      isolationKey = data.isolationKey;
      resTool = new ResTool(socket, {
        projectId: data.projectId,
        scriptId: data.scriptId ?? undefined,
      });
      console.log("[workspaceAgent] 上下文已更新:", isolationKey);
      callback?.({ success: true });
    });

    async function runCommandWithMemory<T>(content: string, userMessageTime: number, runner: () => Promise<T>): Promise<T> {
      const memory = new Memory("workspaceAgent", isolationKey);
      await memory.add("user", content, { createTime: userMessageTime });
      const result = await runner();
      const assistantContent = getFastPathMemoryContent(result);
      if (assistantContent) {
        await memory.add("assistant:commandPipeline", assistantContent);
      }
      return result;
    }

    async function tryRunWorkspaceCommandPipeline(ctx: agent.AgentContext, intent: WorkspaceCommandIntent): Promise<boolean> {
      const projectId = Number(resTool.data.projectId);
      const snapshot = Number.isFinite(projectId) ? await loadProjectSnapshot(projectId) : undefined;
      const plan = await createWorkspaceCommandPlan(ctx.text, snapshot);
      if (!isExecutableWorkspaceCommandPlan(plan)) {
        console.log("[workspaceAgent] workspace command pipeline 未产出可执行计划，回退到大模型总控", { intent });
        return false;
      }

      console.log("[workspaceAgent] workspace command pipeline 执行计划", { intent: plan.intent, confirmationPolicy: plan.confirmationPolicy });
      const userMessageTime = ctx.userMessageTime ?? Date.now();
      await runCommandWithMemory(ctx.text, userMessageTime, () => executeWorkspaceCommandPlan({ resTool: ctx.resTool, msg: ctx.msg, abortSignal: ctx.abortSignal }, plan));
      return true;
    }

    socket.on("chat", async (data: { content: string }) => {
      const { content } = data;
      abortController?.abort();
      abortController = new AbortController();
      const currentController = abortController;

      const msg = resTool.newMessage("assistant", "项目总控");
      const ctx: agent.AgentContext = {
        socket,
        isolationKey,
        text: content,
        userMessageTime: new Date(msg.datetime).getTime() - 1,
        abortSignal: currentController.signal,
        resTool,
        msg,
        thinkConfig,
      };

      try {
        const commandIntent = getWorkspaceCommandCandidateIntent(content);
        if (commandIntent) {
          const handledByPipeline = await tryRunWorkspaceCommandPipeline(ctx, commandIntent);
          if (handledByPipeline) return;
        }

        if (currentController.signal.aborted) {
          return;
        }
        await agent.runDecisionAI(ctx);
      } catch (err: any) {
        if (err.name !== "AbortError" && !currentController.signal.aborted) {
          const errorMessage = u.error(err).message;
          console.error("[workspaceAgent] chat error:", errorMessage);
          if (!err.__workspaceAgentReported) {
            const text = msg.text(`执行失败：${errorMessage}`);
            text.error();
            msg.error(errorMessage);
          }
        }
      } finally {
        if (abortController === currentController) {
          abortController = null;
        }
      }
    });

    socket.on("updateThinkConfig", (data: { think: boolean; thinlLevel: 0 | 1 | 2 | 3 }) => {
      thinkConfig.think = data.think;
      thinkConfig.thinlLevel = data.thinlLevel;
      console.log("[workspaceAgent] 更新思考配置:", thinkConfig);
    });

    socket.on("stop", () => {
      abortController?.abort();
      abortController = null;
    });
  });
  nsp.on("disconnect", (socket: Socket) => {
    console.log("[workspaceAgent] 已断开连接:", socket.id);
  });
};
