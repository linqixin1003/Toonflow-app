import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assertAsoProject, removeOutput } from "@/services/aso/workspace";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    imageId: z.number(),
  }),
  async (req, res) => {
    try {
      const { projectId, imageId } = req.body;
      await assertAsoProject(projectId);
      const workspace = await removeOutput(projectId, imageId);
      res.status(200).send(success({ message: "删除成功", workspace }));
    } catch (e) {
      res.status(400).send(error(u.error(e).message));
    }
  },
);
