import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assertAsoProject, getWorkspace, appendOutput } from "@/services/aso/workspace";
import { acquirePlanGeneration, releasePlanGeneration, resolvePreset, runGenerateJob } from "@/services/aso/imageGenerator";
import { nextEntityId } from "@/services/aso/id";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    planId: z.string(),
    presetId: z.string().optional(),
    assetIds: z.array(z.number()).optional(),
  }),
  async (req, res) => {
    const { projectId, planId, presetId, assetIds: reqAssetIds } = req.body;
    let lockHeld = false;
    try {
      await assertAsoProject(projectId);
      await acquirePlanGeneration(projectId, planId);
      lockHeld = true;

      const workspace = await getWorkspace(projectId);
      const plan = workspace.plans.find((p) => p.id === planId);
      if (!plan) {
        releasePlanGeneration(projectId, planId);
        return res.status(404).send(error("方案不存在"));
      }

      const preset = resolvePreset(presetId || workspace.outputSizePreset);
      const assetIds = reqAssetIds ?? workspace.referencedAssetIds;

      const outputAssetId = nextEntityId();
      await u.db("o_assets").insert({
        id: outputAssetId,
        projectId,
        type: "aso_output",
        name: `ASO-${preset.id}-${outputAssetId}`,
        remark: planId,
        prompt: plan.copy,
        describe: plan.title,
      });

      const [imageId] = await u.db("o_image").insert({
        assetsId: outputAssetId,
        type: "aso_output",
        state: "生成中",
        resolution: `${preset.width}x${preset.height}`,
      });

      await u.db("o_assets").where("id", outputAssetId).update({ imageId });

      await appendOutput(projectId, {
        planId,
        assetId: outputAssetId,
        imageId,
        presetId: preset.id,
        width: preset.width,
        height: preset.height,
        state: "生成中",
        createdAt: Date.now(),
      });

      setImmediate(() => {
        runGenerateJob({
          projectId,
          planId,
          presetId: preset.id,
          assetIds,
          outputAssetId,
          imageId,
        }).catch((e) => console.error("[ASO图生成]", u.error(e).message));
      });

      res.status(200).send(
        success({
          outputAssetId,
          imageId,
          state: "生成中",
          presetId: preset.id,
          width: preset.width,
          height: preset.height,
        }),
      );
    } catch (e) {
      if (lockHeld) releasePlanGeneration(projectId, planId);
      const status = (e as any).statusCode === 409 ? 409 : 400;
      res.status(status).send(error(u.error(e).message));
    }
  },
);
