import express from "express";
import { success, error } from "@/lib/responseFormat";
import u from "@/utils";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    key: z.string().optional(),
    model: z.string().optional(),
    modelName: z.string().optional(),
  }),
  async (req, res) => {
    const { key, model, modelName } = req.body;

    if (modelName) {
      try {
        const [vendorId, rawModelName] = modelName.split(/:(.+)/);
        if (!vendorId || !rawModelName) return res.status(400).send(error("模型配置格式无效"));

        const vendorConfigData = await u.db("o_vendorConfig").where({ id: vendorId, enable: 1 }).first();
        if (!vendorConfigData) return res.status(400).send(error("未找到已启用的供应商配置"));

        const modelList = await u.vendor.getModelList(vendorId);
        const selectedModel = modelList.find((item: any) => item.type === "text" && item.modelName === rawModelName);
        if (!selectedModel) return res.status(400).send(error("未找到该文本模型"));

        const displayModelName = model || selectedModel.name || rawModelName;
        const updated = await u
          .db("o_agentDeploy")
          .where((builder) => {
            builder.where("disabled", false).orWhereNull("disabled");
          })
          .update({
            model: displayModelName,
            modelName: `${vendorId}:${rawModelName}`,
            vendorId,
          });

        return res.status(200).send(
          success({
            updated,
            model: displayModelName,
            modelName: `${vendorId}:${rawModelName}`,
            vendorId,
          }),
        );
      } catch (err) {
        console.error(err);
        return res.status(400).send(error(u.error(err).message));
      }
    }

    if (!key) return res.status(400).send(error("请选择模型或输入KEY"));

    const vendorConfigData = await u.db("o_vendorConfig").where("id", "toonflow").first();
    if (!vendorConfigData) return res.status(500).send(error("未找到该供应商配置"));
    if (!vendorConfigData.inputValues) return res.status(500).send(error("未找到模型配置数据"));
    const inputValue = JSON.parse(vendorConfigData.inputValues!);
    inputValue.apiKey = key;
    await u
      .db("o_vendorConfig")
      .where("id", "toonflow")
      .update({
        inputValues: JSON.stringify(inputValue),
      });
    try {
      const resText = await u.Ai.Text(`toonflow:claude-haiku-4-5-20251001`).invoke({
        prompt: "1+1等于几？,请直接回答2，不要解释",
      });
      if (resText.text) {
        await u.db("o_agentDeploy").where("key", "productionAgent").update({
          model: "claude-sonnet-4-6",
          modelName: "toonflow:claude-sonnet-4-6",
          vendorId: "toonflow",
        });
        await u.db("o_agentDeploy").where("key", "universalAi").update({
          model: "claude-haiku-4-5",
          modelName: "toonflow:claude-haiku-4-5-20251001",
          vendorId: "toonflow",
        });
        res.status(200).send(success("一键填入成功"));
      }
    } catch (err) {
      console.error(err);
      inputValue.apiKey = "";
      await u
        .db("o_vendorConfig")
        .where("id", "toonflow")
        .update({ inputValues: JSON.stringify(inputValue) });
      res.status(400).send(error("KEY无效，请重新输入"));
    }
  },
);
