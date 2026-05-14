import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { getProjectConstraints } from "@/services/projectContext";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
  }),
  async (req, res) => {
    try {
      res.status(200).send(success(await getProjectConstraints(req.body.projectId)));
    } catch (err) {
      res.status(500).send(error(err instanceof Error ? err.message : String(err)));
    }
  },
);
