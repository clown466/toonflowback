import express from "express";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { queueDirectorBoardGeneration } from "@/services/directorBoardGeneration";
import u from "@/utils";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
    storyboardIds: z.array(z.number()).optional(),
    model: z.string().optional(),
    shotsPerBoard: z.number().min(3).max(8).optional(),
    replace: z.boolean().optional(),
    generateImages: z.boolean().optional(),
  }),
  async (req, res) => {
    try {
      const { projectId, scriptId, storyboardIds, model, shotsPerBoard, replace, generateImages } = req.body;
      const rows = await queueDirectorBoardGeneration(projectId, scriptId, {
        storyboardIds,
        model,
        shotsPerBoard,
        replace,
        generateImages,
      });
      res.status(200).send(success(rows));
    } catch (e) {
      res.status(400).send(error(u.error(e).message));
    }
  },
);
