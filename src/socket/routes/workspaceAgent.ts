import jwt from "jsonwebtoken";
import u from "@/utils";
import { Namespace, Socket } from "socket.io";
import * as agent from "@/agents/workspaceAgent/index";
import ResTool from "@/socket/resTool";

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

    socket.on("getImageModels", async (callback) => {
      try {
        const projectId = resTool.data.projectId;
        const project = await u.db("o_project").where("id", projectId).select("imageModel", "imageQuality").first();
        const vendors = await u.db("o_vendorConfig").where("enable", 1).select("id", "name");
        const options = [];
        for (const vendor of vendors) {
          const models = await u.vendor.getModelList(vendor.id);
          const imageModels = models.filter((m: any) => m.type === "image");
          for (const m of imageModels) {
            options.push({
              vendorId: vendor.id,
              vendorName: vendor.name,
              modelName: m.modelName,
              label: m.label || m.modelName,
              value: `${vendor.id}:${m.modelName}`,
            });
          }
        }
        callback?.({
          success: true,
          current: project?.imageModel || null,
          currentQuality: project?.imageQuality || null,
          options,
        });
      } catch (err: any) {
        console.error("[workspaceAgent] getImageModels error:", err);
        callback?.({ success: false, message: err.message });
      }
    });

    socket.on("setImageModel", async (data: { model: string; quality?: string }, callback) => {
      try {
        const projectId = resTool.data.projectId;
        const [vendorId] = data.model.split(":");
        const vendor = await u.db("o_vendorConfig").where("id", vendorId).where("enable", 1).first();
        if (!vendor) {
          callback?.({ success: false, message: "该厂商未启用" });
          return;
        }
        const update: any = { imageModel: data.model };
        if (data.quality) update.imageQuality = data.quality;
        await u.db("o_project").where("id", projectId).update(update);
        console.log("[workspaceAgent] 图像模型已更新:", data.model);
        callback?.({ success: true, model: data.model, quality: data.quality });
      } catch (err: any) {
        console.error("[workspaceAgent] setImageModel error:", err);
        callback?.({ success: false, message: err.message });
      }
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
