import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assertUiuxProject, patchWorkspace } from "@/services/aso/workspace";
import { AsoPlanSchema, AsoOutputRecordSchema, AsoLastPlanGenerationSchema } from "@/services/aso/types";

const patchSchema = z.object({
  inputText: z.string().optional(),
  planCount: z.number().int().min(1).max(10).optional(),
  imagePromptCount: z.number().int().min(0).max(20).optional(),
  plans: z.array(AsoPlanSchema).optional(),
  selectedPlanId: z.string().nullable().optional(),
  referencedAssetIds: z.array(z.number()).optional(),
  outputSizePreset: z.string().optional(),
  outputs: z.array(AsoOutputRecordSchema).optional(),
  lastPlanGeneration: AsoLastPlanGenerationSchema.optional(),
  nodePositions: z.record(z.string(), z.object({ x: z.number(), y: z.number() })).optional(),
});

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    patch: patchSchema,
  }),
  async (req, res) => {
    try {
      const { projectId, patch } = req.body;
      await assertUiuxProject(projectId);
      const { outputs: _clientOutputs, ...safePatch } = patch;
      const workspace = await patchWorkspace(projectId, safePatch);
      res.status(200).send(success({ message: "保存成功", workspace }));
    } catch (e) {
      res.status(400).send(error(u.error(e).message));
    }
  },
);
