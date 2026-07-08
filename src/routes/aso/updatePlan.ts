import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assertAsoProject, updatePlanById } from "@/services/aso/workspace";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    planId: z.string(),
    title: z.string().optional(),
    copy: z.string().optional(),
  }),
  async (req, res) => {
    try {
      const { projectId, planId, title, copy } = req.body;
      await assertAsoProject(projectId);
      const plan = await updatePlanById(projectId, planId, { title, copy });
      res.status(200).send(success({ plan }));
    } catch (e) {
      res.status(400).send(error(u.error(e).message));
    }
  },
);
