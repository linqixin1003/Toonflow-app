import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success, apiError } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assertAsoProject, getWorkspace } from "@/services/aso/workspace";
import { generatePlansSync, validatePlanInput } from "@/services/aso/planGenerator";
import { httpStatusFromError } from "@/services/aso/generationLock";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    inputText: z.string().optional().default(""),
    planCount: z.number().int().min(1).max(10),
    assetIds: z.array(z.number()).optional().default([]),
  }),
  async (req, res) => {
    try {
      const { projectId, inputText, planCount, assetIds } = req.body;
      await assertAsoProject(projectId);
      await validatePlanInput(projectId, inputText, assetIds);

      const { plans, visionFallback } = await generatePlansSync({ projectId, inputText, planCount, assetIds });
      const workspace = await getWorkspace(projectId);
      res.status(200).send(success({ plans, workspace, visionFallback }));
    } catch (e) {
      const status = httpStatusFromError(e);
      res.status(status).send(apiError(u.error(e).message, status));
    }
  },
);
