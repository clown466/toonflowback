import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { saveStoryboardGenerationSkill } from "@/services/storyboardGenerationSkill";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.string().optional().nullable(),
    content: z.string(),
  }),
  async (req, res) => {
    try {
      const skill = await saveStoryboardGenerationSkill({ id: req.body.id ?? undefined, content: req.body.content });
      res.status(200).send(success(skill));
    } catch (err) {
      res.status(500).send(error(err instanceof Error ? err.message : String(err)));
    }
  },
);
