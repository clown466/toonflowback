import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { listRoleFactCards } from "@/services/projectContext";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    assetId: z.number().optional().nullable(),
    roleName: z.string().optional().nullable(),
  }),
  async (req, res) => {
    try {
      res.status(200).send(success(await listRoleFactCards(req.body)));
    } catch (err) {
      res.status(500).send(error(err instanceof Error ? err.message : String(err)));
    }
  },
);
