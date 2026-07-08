import express from "express";
import { z } from "zod";
import u from "@/utils";
import { error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assertAsoProject } from "@/services/aso/workspace";
import { initSse, sendSseEvent, endSse } from "@/services/aso/sse";
import { streamPlansToSse, validatePlanInput } from "@/services/aso/planGenerator";

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

      initSse(res);
      await streamPlansToSse(res, req, { projectId, inputText, planCount, assetIds });
    } catch (e) {
      if (res.headersSent) {
        sendSseEvent(res, "error", { message: u.error(e).message });
        endSse(res);
        return;
      }
      res.status(400).send(error(u.error(e).message));
    }
  },
);
