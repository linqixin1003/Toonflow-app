import express from "express";

import { z } from "zod";

import u from "@/utils";

import { success, error } from "@/lib/responseFormat";

import { validateFields } from "@/middleware/middleware";

import { scheduleVariantGeneration } from "@/services/aso/imageGenerator";



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

      const status = (e as any).statusCode === 404 ? 404 : (e as any).statusCode === 409 ? 409 : 400;

      res.status(status).send(error(u.error(e).message));

    }

  },

);

