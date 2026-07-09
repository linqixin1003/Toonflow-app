import { v4 as uuidv4 } from "uuid";
import path from "path";
import u from "@/utils";
import getPath from "@/utils/getPath";
import { resizeImage } from "@/utils/image";
import { appendOutput, getWorkspace, updateOutputState } from "./workspace";
import { loadAssetReferences, resolvePreset } from "./imageGenerator";
import { nextEntityId } from "./id";
import { resolveNextEditTag } from "./editOutputNaming";
import { isUiuxProject } from "@/constants/projectTypes";
import { releaseOutputEdit, withEditTagLock } from "./generationLock";

export function buildEditPrompt(instruction: string, projectType?: string): string {
  const body = instruction.trim();
  const targetLabel = isUiuxProject(projectType)
    ? "mobile UI/UX design screen"
    : "ASO store screenshot";
  return [
    `Edit the attached ${targetLabel} based on the instructions below.`,
    "Keep the overall layout suitable for the target platform unless the instruction says otherwise.",
    "Instructions:",
    body,
  ].join("\n");
}

export interface ScheduleAsoEditParams {
  projectId: number;
  sourceImageId: number;
  prompt: string;
  modelKey: `${string}:${string}`;
  quality: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
  assetIds: number[];
  apply: boolean;
  projectType?: string;
}

export interface ScheduledAsoEditOutput {
  imageId: number;
  outputAssetId: number;
  sourceImageId: number;
  planId?: string;
  assetId?: number;
  promptSlot?: number;
  promptLabel?: string;
  editTag?: string;
  presetId: string;
  width: number;
  height: number;
  preview: boolean;
  editPrompt: string;
}

export async function loadSourceOutputImage(projectId: number, sourceImageId: number) {
  const row = await u
    .db("o_image")
    .leftJoin("o_assets", "o_image.assetsId", "o_assets.id")
    .where("o_image.id", sourceImageId)
    .where("o_assets.projectId", projectId)
    .where("o_assets.type", "aso_output")
    .select("o_image.id as imageId", "o_image.filePath as filePath", "o_assets.id as assetId")
    .first();
  if (!row?.filePath) {
    throw new Error("成品尚无可用图片，无法编辑");
  }
  return row as { imageId: number; filePath: string; assetId: number };
}

export async function scheduleAsoOutputEdit(params: ScheduleAsoEditParams): Promise<ScheduledAsoEditOutput> {
  const { projectId, sourceImageId, prompt, apply, projectType } = params;

  const workspace = await getWorkspace(projectId);
  const output = workspace.outputs.find((o) => o.imageId === sourceImageId);
  if (!output) {
    const err = new Error("成品不存在");
    (err as any).statusCode = 404;
    throw err;
  }
  if (output.state === "生成中") {
    const err = new Error("成品正在生成中，请稍候");
    (err as any).statusCode = 409;
    throw err;
  }

  const pendingChildEdit = workspace.outputs.some(
    (o) => o.sourceImageId === sourceImageId && o.state === "生成中",
  );
  if (pendingChildEdit) {
    const err = new Error("该成品已有编辑任务进行中，请稍候");
    (err as any).statusCode = 409;
    throw err;
  }

  await loadSourceOutputImage(projectId, sourceImageId);

  const preset = resolvePreset(output.presetId, projectType);
  const editPrompt = buildEditPrompt(prompt, projectType);
  const outputAssetId = nextEntityId();
  let imageId: number | undefined;
  const assetPrefix = isUiuxProject(projectType) ? "UIUX" : "ASO";

  try {
    if (apply) {
      return await withEditTagLock(projectId, output.planId, output.promptSlot, async () => {
        const editTag = resolveNextEditTag(
          (await getWorkspace(projectId)).outputs,
          output.planId,
          output.promptSlot,
        );
        const slotSuffix = output.promptSlot != null ? `-s${output.promptSlot}` : "";
        await u.db("o_assets").insert({
          id: outputAssetId,
          projectId,
          type: "aso_output",
          name: `${assetPrefix}-${preset.id}${slotSuffix}-${editTag}-${outputAssetId}`,
          remark: output.planId,
          prompt: editPrompt,
          describe: output.promptLabel?.trim() || `Edit ${editTag}`,
        });

        const insertedImageIds = await u.db("o_image").insert({
          assetsId: outputAssetId,
          type: "aso_output",
          state: "生成中",
          resolution: `${preset.width}x${preset.height}`,
        });
        imageId = insertedImageIds[0];
        if (imageId == null) throw new Error("创建编辑成品记录失败");
        await u.db("o_assets").where("id", outputAssetId).update({ imageId });

        await appendOutput(projectId, {
          planId: output.planId,
          assetId: outputAssetId,
          imageId,
          presetId: output.presetId,
          width: preset.width,
          height: preset.height,
          state: "生成中",
          promptSlot: output.promptSlot,
          promptLabel: output.promptLabel?.trim() || undefined,
          editTag,
          sourceImageId,
          createdAt: Date.now(),
        });

        return {
          imageId,
          outputAssetId,
          sourceImageId,
          planId: output.planId,
          assetId: outputAssetId,
          promptSlot: output.promptSlot,
          promptLabel: output.promptLabel?.trim() || undefined,
          editTag,
          presetId: preset.id,
          width: preset.width,
          height: preset.height,
          preview: false,
          editPrompt,
        };
      });
    }

    await u.db("o_assets").insert({
      id: outputAssetId,
      projectId,
      type: "aso_output",
      name: `${assetPrefix}-edit-preview-${outputAssetId}`,
      remark: `edit_preview:${sourceImageId}`,
      prompt: editPrompt,
      describe: "Edit preview",
    });

    const insertedImageIds = await u.db("o_image").insert({
      assetsId: outputAssetId,
      type: "aso_output",
      state: "生成中",
      resolution: `${preset.width}x${preset.height}`,
    });
    imageId = insertedImageIds[0];
    if (imageId == null) throw new Error("创建预览记录失败");
    await u.db("o_assets").where("id", outputAssetId).update({ imageId });

    return {
      imageId,
      outputAssetId,
      sourceImageId,
      presetId: preset.id,
      width: preset.width,
      height: preset.height,
      preview: true,
      editPrompt,
    };
  } catch (e) {
    if (imageId != null) {
      await u.db("o_image").where("id", imageId).delete().catch(() => undefined);
    }
    await u.db("o_assets").where("id", outputAssetId).delete().catch(() => undefined);
    throw e;
  }
}

export interface EditOutputJob {
  projectId: number;
  sourceImageId: number;
  newImageId: number;
  outputAssetId: number;
  modelKey: `${string}:${string}`;
  editPrompt: string;
  quality: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
  assetIds: number[];
  presetId: string;
  apply: boolean;
  promptSlot?: number;
  projectType?: string;
}

async function cleanupPreviewRecords(outputAssetId: number, imageId: number) {
  await u.db("o_image").where("id", imageId).delete().catch(() => undefined);
  await u.db("o_assets").where("id", outputAssetId).delete().catch(() => undefined);
}

export async function runEditJob(job: EditOutputJob): Promise<void> {
  const {
    projectId,
    sourceImageId,
    newImageId,
    outputAssetId,
    modelKey,
    editPrompt,
    quality,
    aspectRatio,
    assetIds,
    presetId,
    apply,
    promptSlot,
    projectType,
  } = job;

  const preset = resolvePreset(presetId, projectType);
  const tempRel = `/${projectId}/aso/output/temp-edit-${uuidv4()}.png`;
  const finalRel = `/${projectId}/aso/output/${uuidv4()}.png`;

  try {
    const sourceRow = await loadSourceOutputImage(projectId, sourceImageId);

    const base64 = await u.oss.getImageBase64(sourceRow.filePath);
    const referenceList: { type: "image"; base64: string }[] = [{ type: "image", base64 }];
    if (assetIds.length) {
      const { referenceList: extraRefs } = await loadAssetReferences(projectId, assetIds, promptSlot);
      for (const ref of extraRefs) referenceList.push(ref);
    }

    const aiImage = u.Ai.Image(modelKey);
    await aiImage.run(
      {
        prompt: editPrompt,
        referenceList,
        size: quality,
        aspectRatio,
      },
      {
        taskClass: isUiuxProject(projectType) ? "UIUX图二次编辑" : "ASO图二次编辑",
        describe: `成品 #${sourceImageId} 二次编辑`,
        projectId,
        relatedObjects: JSON.stringify({
          projectId,
          sourceImageId,
          newImageId,
          outputAssetId,
          apply,
          promptSlot,
        }),
      },
    );
    await aiImage.save(tempRel);

    const ossRoot = getPath("oss");
    const tempAbs = path.join(ossRoot, tempRel.replace(/^\//, "").split("/").join(path.sep));
    const finalAbs = path.join(ossRoot, finalRel.replace(/^\//, "").split("/").join(path.sep));
    await resizeImage(tempAbs, finalAbs, {
      width: preset.width,
      height: preset.height,
      fit: "cover",
      withoutEnlargement: false,
    });
    await u.oss.deleteFile(tempRel).catch(() => undefined);

    await u.db("o_image").where("id", newImageId).update({
      state: "已完成",
      filePath: finalRel,
      resolution: `${preset.width}x${preset.height}`,
      errorReason: null,
    });
    if (apply) {
      await updateOutputState(projectId, newImageId, { state: "已完成" });
    }
  } catch (e) {
    const message = u.error(e).message;
    await u.db("o_image").where("id", newImageId).update({ state: "生成失败", errorReason: message });
    if (apply) {
      await updateOutputState(projectId, newImageId, { state: "生成失败", errorReason: message });
    } else {
      await cleanupPreviewRecords(outputAssetId, newImageId);
    }
    throw e;
  } finally {
    releaseOutputEdit(projectId, sourceImageId);
  }
}
