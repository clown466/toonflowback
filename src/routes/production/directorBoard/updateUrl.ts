import express from "express";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number(),
    projectId: z.number(),
    scriptId: z.number(),
    url: z.string(),
    flowId: z.number(),
    prompt: z.string().optional(),
  }),
  async (req, res) => {
    try {
      const { id, projectId, scriptId, url, flowId, prompt } = req.body;
      const patch: Record<string, unknown> = {
        filePath: u.replaceUrl(url),
        flowId,
        state: "已完成",
        reason: "",
        updateTime: Date.now(),
      };
      if (typeof prompt === "string") patch.prompt = prompt;

      const updated = await u.db("o_directorBoard").where({ id, projectId, scriptId }).update(patch);
      if (!updated) return res.status(404).send(error("章节导演板不存在，无法保存。"));
      res.status(200).send(success({ message: "章节导演板已更新" }));
    } catch (e) {
      res.status(400).send(error(u.error(e).message));
    }
  },
);
