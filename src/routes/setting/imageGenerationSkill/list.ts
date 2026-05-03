import express from "express";
import { success, error } from "@/lib/responseFormat";
import { listImageGenerationSkills } from "@/services/imageGenerationSkill";

const router = express.Router();

export default router.post("/", async (_, res) => {
  try {
    res.status(200).send(success(await listImageGenerationSkills()));
  } catch (err) {
    res.status(500).send(error(err instanceof Error ? err.message : String(err)));
  }
});
