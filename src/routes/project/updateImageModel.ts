import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number(),
    imageModel: z.string().min(1),
  }),
  async (req, res) => {
    const { id, imageModel } = req.body;
    const [vendorId, modelName] = imageModel.split(/:(.+)/);

    if (!vendorId || !modelName) {
      return res.status(400).send({ error: "出图模型格式无效" });
    }

    const models = await u.vendor.getModelList(vendorId);
    const model = models.find((item: any) => item.modelName === modelName && item.type === "image");
    if (!model) {
      return res.status(404).send({ error: `图像模型 ${imageModel} 未找到` });
    }

    const updated = await u.db("o_project").where("id", id).update({ imageModel });
    if (!updated) {
      return res.status(404).send({ error: "项目不存在" });
    }

    res.status(200).send(success({ id, imageModel, message: "出图模型已更新" }));
  },
);
