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
    imageSize: z.enum(["1K", "2K", "4K"]).optional(),
    imageQuality: z.enum(["1K", "2K", "4K"]).optional(),
    boardType: z.enum(["continuity", "textStoryboard", "hybridStoryboard", "spatialSixPanel"]).optional(),
    shotsPerBoard: z.number().min(3).max(8).optional(),
    replace: z.boolean().optional(),
    generateImages: z.boolean().optional(),
    usePreviousBoardReference: z.boolean().optional(),
  }),
  async (req, res) => {
    try {
      const { projectId, scriptId, storyboardIds, model, imageSize, imageQuality, boardType, shotsPerBoard, replace, generateImages, usePreviousBoardReference } = req.body;
      const rows = await queueDirectorBoardGeneration(projectId, scriptId, {
        storyboardIds,
        model,
        imageSize: imageSize || imageQuality,
        boardType,
        shotsPerBoard,
        replace,
        generateImages,
        usePreviousBoardReference,
      });
      res.status(200).send(success(rows));
    } catch (e) {
      res.status(400).send(error(u.error(e).message));
    }
  },
);
