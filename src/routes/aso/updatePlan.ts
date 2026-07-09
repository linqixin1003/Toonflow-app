import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assertAsoProject, updatePlanById } from "@/services/aso/workspace";
import { AsoImagePromptSchema } from "@/services/aso/types";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    planId: z.string(),
    title: z.string().optional(),
    copy: z.string().optional(),
    imagePrompts: z.array(AsoImagePromptSchema).optional(),
  }),
  async (req, res) => {
    try {
      const { projectId, planId, title, copy, imagePrompts } = req.body;
      await assertAsoProject(projectId);
      const plan = await updatePlanById(projectId, planId, { title, copy, imagePrompts });
      res.status(200).send(success({ plan }));
    } catch (e) {
      res.status(400).send(error(u.error(e).message));
    }
  },
);
