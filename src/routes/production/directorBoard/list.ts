import express from "express";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { listDirectorBoards } from "@/services/directorBoardGeneration";
import u from "@/utils";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
  }),
  async (req, res) => {
    try {
      const { projectId, scriptId } = req.body;
      res.status(200).send(success(await listDirectorBoards(projectId, scriptId)));
    } catch (e) {
      res.status(400).send(error(u.error(e).message));
    }
  },
);
