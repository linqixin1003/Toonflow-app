import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success, apiError } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assertUiuxProject } from "@/services/aso/workspace";
import { generatePlansSync, validatePlanInput, resolveAppendContext } from "@/services/aso/planGenerator";
import { resolveImagePromptCount } from "@/services/aso/numberedPoints";
import { httpStatusFromError } from "@/services/aso/generationLock";
import { getWorkspace } from "@/services/aso/workspace";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    inputText: z.string().optional().default(""),
    planCount: z.number().int().min(1).max(10),
    imagePromptCount: z.number().int().min(0).max(20).optional(),
    assetIds: z.array(z.number()).optional().default([]),
    appendPlans: z.boolean().optional().default(false),
  }),
  async (req, res) => {
    try {
      const { projectId, inputText, planCount, assetIds, appendPlans } = req.body;
      const imagePromptCount = resolveImagePromptCount(inputText, req.body.imagePromptCount);
      await assertUiuxProject(projectId);
      await validatePlanInput(projectId, inputText, assetIds);
      await resolveAppendContext(projectId, planCount, appendPlans);

      const { plans, visionFallback } = await generatePlansSync({
        projectId,
        inputText,
        planCount,
        imagePromptCount,
        assetIds,
        appendPlans,
        projectType: "uiux",
      });
      const workspace = await getWorkspace(projectId);
      res.status(200).send(success({ plans, workspace, visionFallback }));
    } catch (e) {
      const status = httpStatusFromError(e);
      res.status(status).send(apiError(u.error(e).message, status));
    }
  },
);
