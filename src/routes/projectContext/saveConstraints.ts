import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { saveProjectConstraints } from "@/services/projectContext";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    content: z.string(),
    sourceType: z.enum(["user_to_controller", "md_project_skill", "project_setting", "manual", "agent_inferred"]).optional(),
    sourceRef: z.string().optional().nullable(),
  }),
  async (req, res) => {
    try {
      res.status(200).send(success(await saveProjectConstraints(req.body)));
    } catch (err) {
      res.status(500).send(error(err instanceof Error ? err.message : String(err)));
    }
  },
);
