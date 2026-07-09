import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success, apiError } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assertUiuxProject, getWorkspace } from "@/services/aso/workspace";
import {
  resolvePreset,
  runGenerateJob,
  scheduleAsoOutputGeneration,
} from "@/services/aso/imageGenerator";
import { httpStatusFromError } from "@/services/aso/generationLock";

const router = express.Router();

const STAGGER_MS = 800;

function queueGenerateJob(
  job: Parameters<typeof runGenerateJob>[0],
  delayMs: number,
) {
  const start = () => {
    runGenerateJob(job).catch((e) => console.error("[UIUX图生成]", u.error(e).message));
  };
  if (delayMs <= 0) {
    setImmediate(start);
  } else {
    setTimeout(start, delayMs);
  }
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    planId: z.string(),
    presetId: z.string().optional(),
    assetIds: z.array(z.number()).optional(),
    promptSlot: z.number().int().min(1).optional(),
    generateAll: z.boolean().optional(),
  }),
  async (req, res) => {
    const { projectId, planId, presetId, assetIds: reqAssetIds, promptSlot, generateAll } = req.body;
    try {
      if (generateAll && promptSlot != null) {
        return res.status(400).send(apiError("generateAll 与 promptSlot 不能同时使用", 400));
      }

      await assertUiuxProject(projectId);

      const workspace = await getWorkspace(projectId);
      const plan = workspace.plans.find((p) => p.id === planId);
      if (!plan) {
        return res.status(404).send(apiError("方案不存在", 404));
      }

      const preset = resolvePreset(presetId || workspace.outputSizePreset, "uiux");
      const assetIds = reqAssetIds ?? workspace.referencedAssetIds;

      type SlotTarget = { promptSlot?: number; promptLabel?: string };
      let targets: SlotTarget[] = [];

      if (generateAll) {
        if (plan.imagePrompts?.length) {
          targets = plan.imagePrompts.map((ip) => ({
            promptSlot: ip.slot,
            promptLabel: ip.label,
          }));
        } else {
          targets = [{}];
        }
      } else if (promptSlot != null) {
        const ip = plan.imagePrompts?.find((p) => p.slot === promptSlot);
        if (!ip) {
          return res.status(404).send(apiError(`分镜 ${promptSlot} 不存在`, 404));
        }
        targets = [{ promptSlot: ip.slot, promptLabel: ip.label }];
      } else {
        targets = [{}];
      }

      const scheduled = [];
      const failed: { promptSlot?: number; error: string }[] = [];

      for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        try {
          const output = await scheduleAsoOutputGeneration({
            projectId,
            planId,
            presetId: preset.id,
            assetIds,
            promptSlot: target.promptSlot,
            promptLabel: target.promptLabel,
            projectType: "uiux",
          });
          scheduled.push(output);
          queueGenerateJob(
            {
              projectId,
              planId,
              presetId: preset.id,
              assetIds,
              outputAssetId: output.outputAssetId,
              imageId: output.imageId,
              promptSlot: target.promptSlot,
              projectType: "uiux",
            },
            i * STAGGER_MS,
          );
        } catch (e) {
          const message = u.error(e).message;
          failed.push({ promptSlot: target.promptSlot, error: message });
          if (scheduled.length === 0 && failed.length === targets.length) {
            throw e;
          }
          console.error("[UIUX图生成] 批量调度失败", message);
        }
      }

      if (scheduled.length === 0) {
        return res.status(409).send(apiError("没有可提交的生成任务", 409));
      }

      res.status(200).send(
        success({
          outputs: scheduled,
          failed,
          outputAssetId: scheduled[0].outputAssetId,
          imageId: scheduled[0].imageId,
          state: "生成中",
          presetId: preset.id,
          width: preset.width,
          height: preset.height,
        }),
      );
    } catch (e) {
      const status = httpStatusFromError(e);
      res.status(status).send(apiError(u.error(e).message, status));
    }
  },
);
