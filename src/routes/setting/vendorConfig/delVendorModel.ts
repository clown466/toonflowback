import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.string(),
    modelName: z.string(),
  }),
  async (req, res) => {
    const { id, modelName } = req.body;

    const row = await u.db("o_vendorConfig").where("id", id).first("models", "hiddenModels");
    if (row?.models) {
      const existingModels = JSON.parse(row.models);
      const hiddenModels = new Set<string>(JSON.parse(row.hiddenModels ?? "[]"));
      const baseModels = u.vendor.getVendor(id)?.models ?? [];
      if (!existingModels.some((model: any) => model.modelName === modelName)) {
        if (!baseModels.some((model: any) => model.modelName === modelName)) {
          return res.status(400).send(error("未找到该模型"));
        }
        hiddenModels.add(modelName);
        await u
          .db("o_vendorConfig")
          .where("id", id)
          .update({
            hiddenModels: JSON.stringify([...hiddenModels]),
          });
        return res.status(200).send(success("更新成功"));
      }
      const updatedModels = existingModels.filter((model: any) => model.modelName !== modelName);
      if (baseModels.some((model: any) => model.modelName === modelName)) {
        hiddenModels.add(modelName);
      }
      await u
        .db("o_vendorConfig")
        .where("id", id)
        .update({
          models: JSON.stringify(updatedModels),
          hiddenModels: JSON.stringify([...hiddenModels]),
        });
    }
    res.status(200).send(success("更新成功"));
  },
);
