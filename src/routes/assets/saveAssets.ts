import express from "express";
import u from "@/utils";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import sharp from "sharp";
import { queueRoleFactCardVisionRefresh, syncRoleFactCardFallback, type SyncRoleFactCardResult } from "@/services/roleFactCard";
const router = express.Router();

// 保存资产图片
export default router.post(
  "/",
  validateFields({
    id: z.number(),
    projectId: z.number(),
    base64: z.string().optional().nullable(),
    type: z.enum(["role", "scene", "tool"]),
    prompt: z.string().optional().nullable(),
    imageId: z.number().optional().nullable(),
  }),
  async (req, res) => {
    const { id, base64, type, prompt, projectId, imageId } = req.body;
    let roleFactCardResult: SyncRoleFactCardResult | null = null;
    if (base64) {
      //自定义上传选择的图片
      const matches = base64.match(/^data:image\/\w+;base64,(.+)$/);
      const realBase64 = (matches ? matches[1] : base64).replace(/\s/g, "");
      let imageBuffer: Buffer;
      try {
        imageBuffer = await sharp(Buffer.from(realBase64, "base64")).rotate().png().toBuffer();
      } catch {
        return res.status(400).send(error("上传图片格式不支持或文件已损坏"));
      }
      // 生成新的图片路径
      const savePath = `/${projectId}/${type}/${uuidv4()}.png`;
      // 写入文件
      await u.oss.writeFile(savePath, imageBuffer);
      // 插入图片表
      const [idData] = await u.db("o_image").insert({
        assetsId: id,
        filePath: savePath,
        type: type,
        state: "已完成",
      });
      // 更新资产表图片为新图片
      await u
        .db("o_assets")
        .where("id", id)
        .update({
          prompt: prompt ?? "",
          imageId: idData,
        });
      if (type === "role") {
        roleFactCardResult = await syncRoleFactCardFallback(id, projectId);
        queueRoleFactCardVisionRefresh(id, projectId, `data:image/png;base64,${imageBuffer.toString("base64")}`);
      }
    } else {
      await u
        .db("o_assets")
        .where("id", id)
        .update({
          prompt: prompt ?? "",
          imageId: imageId,
        });
      if (type === "role") {
        roleFactCardResult = await syncRoleFactCardFallback(id, projectId);
        queueRoleFactCardVisionRefresh(id, projectId);
      }
    }
    res.status(200).send(success({ message: "保存资产图片成功", roleFactCard: roleFactCardResult?.card ?? null }));
  },
);
