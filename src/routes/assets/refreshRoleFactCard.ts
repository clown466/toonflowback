import express from "express";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { queueRoleFactCardVisionRefresh, syncRoleFactCardFallback } from "@/services/roleFactCard";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number(),
    projectId: z.number().optional(),
  }),
  async (req, res) => {
    const { id, projectId } = req.body;
    const result = await syncRoleFactCardFallback(id, projectId);
    queueRoleFactCardVisionRefresh(id, projectId);
    res.status(200).send(success({ message: "角色事实卡已同步，后台会继续尝试看图识别", roleFactCard: result.card ?? null }));
  },
);
