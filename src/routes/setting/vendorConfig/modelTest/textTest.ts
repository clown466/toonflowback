import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";
const router = express.Router();

// 检查语言模型
export default router.post(
  "/",
  validateFields({
    modelName: z.string(),
    id: z.string(),
    messages: z.array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      }),
    ),
  }),
  async (req, res) => {
    const { modelName, messages, id } = req.body;

    try {
      const vendorConfigData = await u.db("o_vendorConfig").where("id", id).first();

      if (!vendorConfigData) return res.status(500).send(error("未找到该供应商配置"));
      if (!vendorConfigData.models) return res.status(500).send(error("未找到模型列表"));

      const modelList = await u.vendor.getModelList(vendorConfigData.id!);
      const selectedModel = modelList.find((i: any) => i.modelName == modelName);
      if (!selectedModel) return res.status(500).send(error(`未找到模型 ${modelName}`));

      const data = await u.Ai.Text(`${id}:${modelName}`).invoke({
        messages,
      });
      if (!data?.text?.trim()) return res.status(500).send(error("模型未返回文本结果"));
      res.status(200).send(success({ thinking: data.reasoningText, content: data.text }));
    } catch (err) {
      console.error(err);
      const msg = u.error(err).message;
      console.error(msg);
      res.status(500).send(error(msg));
    }
  },
);
