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
    imageBase64: z.string().optional(),
    imageBase64List: z.array(z.string()).optional(),
    prompt: z.string().optional(),
  }),
  async (req, res) => {
    const { modelName, imageBase64, imageBase64List, id } = req.body;
    const prompt = req.body.prompt?.trim() || "请基于输入内容生成一张清晰、构图完整、细节丰富的测试图片";
    const referenceList = (Array.isArray(imageBase64List) && imageBase64List.length > 0 ? imageBase64List : imageBase64 ? [imageBase64] : [])
      .filter((item: string) => typeof item === "string" && item.trim())
      .map((base64: string) => ({ type: "image" as const, base64 }));

    try {
      const vendorConfigData = await u.db("o_vendorConfig").where("id", id).first();

      if (!vendorConfigData) return res.status(500).send(error("未找到该供应商配置"));
      if (!vendorConfigData.models) return res.status(500).send(error("未找到模型列表"));
      const modelList = await u.vendor.getModelList(vendorConfigData.id!);
      const selectedModel = modelList.find((i: any) => i.modelName == modelName);
      if (!selectedModel) return res.status(500).send(error(`未找到模型 ${modelName}`));

      const reqFn = await u.Ai.Image(`${id}:${modelName}`).run({
        prompt,
        referenceList, //输入的图片提示词
        size: "1K", // 图片尺寸
        aspectRatio: "1:1",
      });
      await reqFn.save("testImage.jpg");
      const resultUrl = await u.oss.getFileUrl("testImage.jpg");
      res.status(200).send(success(resultUrl));
    } catch (err) {
      console.error(err);
      const msg = u.error(err).message;
      console.error(msg);
      res.status(500).send(error(msg));
    }
  },
);
