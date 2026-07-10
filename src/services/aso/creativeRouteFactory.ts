import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success, error, apiError } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { getOrCreateWorkspace, getWorkspace, patchWorkspace } from "@/services/aso/workspace";
import { AsoPlanSchema, AsoOutputRecordSchema, AsoLastPlanGenerationSchema } from "@/services/aso/types";
import { resolveMaterialKind, parseTextMaterialSlot } from "@/services/aso/materialKind";
import {
  resolvePreset,
  runGenerateJob,
  scheduleAsoOutputGeneration,
} from "@/services/aso/imageGenerator";
import { httpStatusFromError } from "@/services/aso/generationLock";

type AssertProject = (projectId: number) => Promise<unknown>;

const workspacePatchSchema = z.object({
  inputText: z.string().optional(),
  rawInputText: z.string().optional(),
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

/** Shared saveWorkspace handler for ASO / UI-UX. */
export function createSaveWorkspaceRouter(assertProject: AssertProject) {
  const router = express.Router();
  router.post(
    "/",
    validateFields({
      projectId: z.number(),
      patch: workspacePatchSchema,
    }),
    async (req, res) => {
      try {
        const { projectId, patch } = req.body;
        await assertProject(projectId);
        const { outputs: _clientOutputs, ...safePatch } = patch;
        const workspace = await patchWorkspace(projectId, safePatch);
        res.status(200).send(success({ message: "保存成功", workspace }));
      } catch (e) {
        res.status(400).send(error(u.error(e).message));
      }
    },
  );
  return router;
}

/** Shared getWorkspace handler for ASO / UI-UX (includes materials). */
export function createGetWorkspaceRouter(assertProject: AssertProject) {
  const router = express.Router();
  router.post(
    "/",
    validateFields({
      projectId: z.number(),
    }),
    async (req, res) => {
      try {
        const { projectId } = req.body;
        await assertProject(projectId);
        const workspace = await getOrCreateWorkspace(projectId);
        const assetRows = await u
          .db("o_assets")
          .leftJoin("o_image", "o_assets.imageId", "o_image.id")
          .where("o_assets.projectId", projectId)
          .where("o_assets.type", "aso_material")
          .select(
            "o_assets.id",
            "o_assets.name",
            "o_assets.describe",
            "o_assets.remark",
            "o_image.id as imageId",
            "o_image.filePath",
            "o_image.state",
          );

        const materials = await Promise.all(
          assetRows.map(async (row: any) => {
            const materialKind = resolveMaterialKind(row);
            return {
              id: row.id,
              name: row.name,
              type: "aso_material",
              materialKind,
              promptSlot: materialKind === "text" ? parseTextMaterialSlot(row.remark) : undefined,
              describe: row.describe,
              remark: row.remark,
              imageId: row.imageId,
              filePath: row.filePath ? await u.oss.getSmallImageUrl(row.filePath) : null,
              state: row.state,
            };
          }),
        );

        res.status(200).send(success({ workspace, materials }));
      } catch (e) {
        res.status(400).send(error(u.error(e).message));
      }
    },
  );
  return router;
}

const STAGGER_MS = 800;

export interface GenerateImageRouteOptions {
  assertProject: AssertProject;
  projectType: "aso" | "uiux";
  logLabel: string;
}

/** Shared generate-image handler for ASO / UI-UX. */
export function createGenerateImageRouter(options: GenerateImageRouteOptions) {
  const { assertProject, projectType, logLabel } = options;
  const router = express.Router();

  function queueGenerateJob(job: Parameters<typeof runGenerateJob>[0], delayMs: number) {
    const start = () => {
      runGenerateJob(job).catch((e) => console.error(`[${logLabel}]`, u.error(e).message));
    };
    if (delayMs <= 0) setImmediate(start);
    else setTimeout(start, delayMs);
  }

  router.post(
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

        await assertProject(projectId);

        const workspace = await getWorkspace(projectId);
        const plan = workspace.plans.find((p) => p.id === planId);
        if (!plan) {
          return res.status(404).send(apiError("方案不存在", 404));
        }

        const preset = resolvePreset(presetId || workspace.outputSizePreset, projectType);
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
              projectType,
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
                projectType,
              },
              i * STAGGER_MS,
            );
          } catch (e) {
            const message = u.error(e).message;
            failed.push({ promptSlot: target.promptSlot, error: message });
            if (scheduled.length === 0 && failed.length === targets.length) {
              throw e;
            }
            console.error(`[${logLabel}] 批量调度失败`, message);
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

  return router;
}
