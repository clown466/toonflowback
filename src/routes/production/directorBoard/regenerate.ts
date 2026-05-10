import express from "express";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { regenerateDirectorBoard } from "@/services/directorBoardGeneration";
import u from "@/utils";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
    boardId: z.number(),
    model: z.string().optional(),
    boardType: z.enum(["continuity", "textStoryboard", "hybridStoryboard"]).optional(),
  }),
  async (req, res) => {
    try {
      const { projectId, scriptId, boardId, model, boardType } = req.body;
      res.status(200).send(success(await regenerateDirectorBoard(projectId, scriptId, boardId, { model, boardType })));
    } catch (e) {
      res.status(400).send(error(u.error(e).message));
    }
  },
);
