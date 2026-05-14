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

    const models = await u.db("o_vendorConfig").where("id", id).first("models");
    if (models?.models) {
      const existingModels = u.vendor.parseVendorModels(models.models);
      const result = u.vendor.deleteVendorModelConfig(existingModels, modelName, u.vendor.getCodeModelList(id));
      if (!result.found) {
        return res.status(400).send(error("模型不存在"));
      }
      await u
        .db("o_vendorConfig")
        .where("id", id)
        .update({
          models: JSON.stringify(result.models),
        });
    }
    res.status(200).send(success("更新成功"));
  },
);
