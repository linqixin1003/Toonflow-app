import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success, apiError } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { scheduleVariantGeneration } from "@/services/aso/imageGenerator";
import { httpStatusFromError } from "@/services/aso/generationLock";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    sourceAssetId: z.number(),
    copy: z.string().min(1),
    count: z.number().int().min(1).max(10),
  }),
  async (req, res) => {
    try {
      const { projectId, sourceAssetId, copy, count } = req.body;
      const data = await scheduleVariantGeneration({ projectId, sourceAssetId, copy, count });
      res.status(200).send(success(data));
    } catch (e) {
      const status = httpStatusFromError(e);
      res.status(status).send(apiError(u.error(e).message, status));
    }
  },
);
