import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { saveRoleFactCard } from "@/services/projectContext";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.string().optional().nullable(),
    projectId: z.number(),
    assetId: z.number().optional().nullable(),
    roleName: z.string(),
    sourceType: z.enum(["uploaded_image", "user", "agent_inferred", "manual"]),
    confidence: z.number().min(0).max(1),
    facts: z.string(),
    negativeFacts: z.string().optional().nullable(),
  }),
  async (req, res) => {
    try {
      res.status(200).send(success(await saveRoleFactCard(req.body)));
    } catch (err) {
      res.status(500).send(error(err instanceof Error ? err.message : String(err)));
    }
  },
);
