import express from "express";
import { serializeError } from "serialize-error";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";
import { transform } from "sucrase";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.string(),
    name: z.string().min(1).max(80),
  }),
  async (req, res) => {
    try {
      const { id } = req.body;
      const name = req.body.name.trim();
      if (!name) return res.status(400).send(error("供应商名称不能为空"));
      if (/[\r\n]/.test(name)) return res.status(400).send(error("供应商名称不能包含换行"));

      const code = u.vendor.getCode(id);
      if (!code) return res.status(404).send(error("未找到供应商代码"));

      const currentVendor = u.vendor.getVendor(id);
      if (!currentVendor) return res.status(404).send(error("未找到供应商配置"));
      if (currentVendor.id !== id) {
        return res.status(400).send(error(`供应商ID与文件名不一致。当前供应商ID是 ${id}，代码里的ID是 ${currentVendor.id}`));
      }

      const nextCode = u.vendor.updateVendorNameInCode(code, name);
      const nextExports = u.vm(transform(nextCode, { transforms: ["typescript"] }).code);
      if (!nextExports?.vendor) return res.status(400).send(error("脚本文件必须导出vendor对象"));
      if (nextExports.vendor.id !== id) return res.status(400).send(error("供应商ID不可修改"));
      if (nextExports.vendor.name !== name) return res.status(400).send(error("供应商名称更新失败"));

      u.vendor.writeCode(id, nextCode);

      res.status(200).send(success({ id, name }));
    } catch (err) {
      console.log(err);
      res.status(400).send(error(serializeError(err).message || "未知错误"));
    }
  },
);
