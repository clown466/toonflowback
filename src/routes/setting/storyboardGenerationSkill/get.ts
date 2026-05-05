import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { getStoryboardGenerationSkill } from "@/services/storyboardGenerationSkill";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.string(),
  }),
  async (req, res) => {
    try {
      res.status(200).send(success(await getStoryboardGenerationSkill(req.body.id)));
    } catch (err) {
      res.status(500).send(error(err instanceof Error ? err.message : String(err)));
    }
  },
);
