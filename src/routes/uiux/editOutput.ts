import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success, apiError } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assertUiuxProject } from "@/services/aso/workspace";
import { runEditJob, scheduleAsoOutputEdit } from "@/services/aso/editOutputGenerator";
import { acquireOutputEdit, httpStatusFromError } from "@/services/aso/generationLock";

const router = express.Router();

function queueEditJob(job: Parameters<typeof runEditJob>[0]) {
  setImmediate(() => {
    runEditJob(job).catch((e) => console.error("[UIUX图二次编辑]", u.error(e).message));
  });
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    imageId: z.number(),
    prompt: z.string().min(1),
    model: z.string().optional(),
    quality: z.enum(["1K", "2K", "4K"]).optional(),
    aspectRatio: z.string().optional(),
    assetIds: z.array(z.number()).optional(),
    apply: z.boolean().optional().default(true),
  }),
  async (req, res) => {
    const {
      projectId,
      imageId,
      prompt,
      model,
      quality,
      aspectRatio,
      assetIds: extraAssetIds,
      apply = true,
    } = req.body;

    let releaseEdit: (() => void) | undefined;
    let jobQueued = false;

    try {
      await assertUiuxProject(projectId);

      const project = await u.db("o_project").where("id", projectId).first();
      const modelKey = (model || project?.imageModel) as `${string}:${string}` | undefined;
      if (!modelKey) {
        return res.status(400).send(apiError("请先配置项目 imageModel", 400));
      }

      releaseEdit = acquireOutputEdit(projectId, imageId);

      const { getWorkspace } = await import("@/services/aso/workspace");
      const workspace = await getWorkspace(projectId);
      const output = workspace.outputs.find((o) => o.imageId === imageId);
      if (!output?.presetId) {
        releaseEdit?.();
        return res.status(404).send(apiError("成品不存在", 404));
      }

      const { resolvePreset } = await import("@/services/aso/imageGenerator");
      const preset = resolvePreset(output.presetId, "uiux");
      const sizeTier = quality ?? preset.sizeTier;
      const ratio = (aspectRatio ?? preset.aspectRatio) as `${number}:${number}`;
      const assetIds = extraAssetIds ?? workspace.referencedAssetIds ?? [];

      const scheduled = await scheduleAsoOutputEdit({
        projectId,
        sourceImageId: imageId,
        prompt,
        modelKey,
        quality: sizeTier,
        aspectRatio: ratio,
        assetIds,
        apply,
        projectType: "uiux",
      });

      queueEditJob({
        projectId,
        sourceImageId: imageId,
        newImageId: scheduled.imageId,
        outputAssetId: scheduled.outputAssetId,
        modelKey,
        editPrompt: scheduled.editPrompt,
        quality: sizeTier,
        aspectRatio: ratio,
        assetIds,
        presetId: scheduled.presetId,
        apply,
        promptSlot: scheduled.promptSlot,
        projectType: "uiux",
      });
      jobQueued = true;

      res.status(200).send(
        success({
          imageId: scheduled.imageId,
          sourceImageId: scheduled.sourceImageId,
          editTag: scheduled.editTag,
          planId: scheduled.planId,
          assetId: scheduled.assetId,
          promptSlot: scheduled.promptSlot,
          promptLabel: scheduled.promptLabel,
          presetId: scheduled.presetId,
          width: scheduled.width,
          height: scheduled.height,
          state: "生成中",
          preview: scheduled.preview,
          createdAt: Date.now(),
        }),
      );
    } catch (e) {
      if (!jobQueued) releaseEdit?.();
      const status = httpStatusFromError(e);
      res.status(status).send(apiError(u.error(e).message, status));
    }
  },
);
