import jwt from "jsonwebtoken";
import u from "@/utils";
import { Namespace, Socket } from "socket.io";
import * as agent from "@/agents/workspaceAgent/index";
import ResTool from "@/socket/resTool";
import { runNovelAssetExtractionFastPath, runProjectAssetImageGenerationFastPath, runProjectStoryboardClearFastPath, runProjectStoryboardDraftFastPath } from "@/agents/workspaceAgent/tools";

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

    socket.on("updateContext", (data: { isolationKey: string; projectId: number }, callback) => {
      isolationKey = data.isolationKey;
      resTool = new ResTool(socket, {
        projectId: data.projectId,
      });
      console.log("[workspaceAgent] 上下文已更新:", isolationKey);
      callback?.({ success: true });
    });

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
        const shouldFastClearStoryboards =
          /(清空|清除|删除|删掉|移除|重置).{0,12}(分镜|镜头|storyboard)|(分镜|镜头|storyboard).{0,12}(清空|清除|删除|删掉|移除|重置)/i.test(content);
        if (shouldFastClearStoryboards) {
          console.log("[workspaceAgent] 命中清空分镜快速路径");
          await runProjectStoryboardClearFastPath({ resTool, msg }, { sourceText: content });
          return;
        }

        const shouldFastGenerateStoryboards =
          /(分镜|镜头|storyboard|镜号|shot list)/i.test(content) &&
          /(出|生成|做|创建|规划|拆|整理|帮我|开始|直接|一键|一句话|生产)/i.test(content);
        if (shouldFastGenerateStoryboards) {
          console.log("[workspaceAgent] 命中生产分镜快速路径");
          await runProjectStoryboardDraftFastPath({ resTool, msg }, { sourceText: content });
          return;
        }

        const explicitAssetImageIntent =
          /(资产|角色|场景|道具|参考图).*(出图|生图|生成.*图|批量.*图|图片)|(出图|生图|生成.*图).*(资产|角色|场景|道具|参考图)/i.test(content);
        const genericBatchImageIntent =
          /(批量|全部|所有|统一|帮我|开始|直接).{0,16}(出图|生图|生成.*图)|(出图|生图).{0,16}(批量|全部|所有|统一)/i.test(content) &&
          !/(分镜|镜头|storyboard|视频)/i.test(content);
        const shouldFastGenerateAssetImages = explicitAssetImageIntent || genericBatchImageIntent;
        if (shouldFastGenerateAssetImages) {
          console.log("[workspaceAgent] 命中资产批量出图快速路径");
          await runProjectAssetImageGenerationFastPath({ resTool, msg }, { sourceText: content });
          return;
        }

        const shouldFastExtractAssets = /提取?资产|提资产|资产库|角色.*场景.*道具|塑角造景|准备资产/i.test(content);
        if (shouldFastExtractAssets) {
          console.log("[workspaceAgent] 命中小说资产提取快速路径");
          await runNovelAssetExtractionFastPath({ resTool, msg });
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
