import { v4 as uuidv4 } from "uuid";
import u from "@/utils";
import { getPresetById, getDefaultPreset, type AsoSizePreset } from "@/constants/asoSizePresets";
import { resizeImage } from "@/utils/image";
import path from "path";
import getPath from "@/utils/getPath";
import {
  appendOutput,
  assertAsoProject,
  updateOutputState,
  getWorkspace,
} from "./workspace";
import { acquirePlanGeneration, releasePlanGeneration, acquireVariantGeneration } from "./generationLock";
import { nextEntityId, nextEntityIds } from "./id";
import type { AsoPlan } from "./types";

export function resolvePreset(presetId?: string): AsoSizePreset {
  return getPresetById(presetId || "") ?? getDefaultPreset();
}

export async function loadAssetReferences(projectId: number, assetIds: number[]) {
  const rows = await u
    .db("o_assets")
    .leftJoin("o_image", "o_assets.imageId", "o_image.id")
    .where("o_assets.projectId", projectId)
    .whereIn("o_assets.id", assetIds)
    .where("o_assets.type", "aso_material")
    .select("o_assets.id", "o_assets.describe", "o_image.filePath");

  const referenceList: { type: "image"; base64: string }[] = [];
  const textLines: string[] = [];

  for (const row of rows) {
    if (row.filePath) {
      const dataUrl = await u.oss.getImageBase64(row.filePath);
      const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
      referenceList.push({ type: "image", base64 });
    } else if (row.describe) {
      textLines.push(row.describe);
    }
  }

  return { referenceList, textLines };
}

export function buildImagePrompt(plan: AsoPlan, project: any, preset: AsoSizePreset, textLines: string[]): string {
  const textBlock = textLines.length ? `\n素材描述：\n${textLines.map((t) => `- ${t}`).join("\n")}` : "";
  return [
    `生成 ASO 商店宣传图，尺寸目标 ${preset.width}x${preset.height}（${preset.label}）。`,
    `画风：${project.artStyle || "未指定"}`,
    `创意标题：${plan.title}`,
    `创意正文：${plan.copy}`,
    textBlock,
    "要求：清晰可读的文字排版，适合 App Store / Google Play 展示，无违规内容。",
  ].join("\n");
}

export interface GenerateAsoImageJob {
  projectId: number;
  planId: string;
  presetId: string;
  assetIds: number[];
  outputAssetId: number;
  imageId: number;
}

export async function runGenerateJob(job: GenerateAsoImageJob) {
  const { projectId, planId, presetId, assetIds, imageId } = job;
  const preset = resolvePreset(presetId);
  const project = await u.db("o_project").where("id", projectId).first();
  const workspace = await getWorkspace(projectId);
  const plan = workspace.plans.find((p) => p.id === planId);
  if (!plan) {
    releasePlanGeneration(projectId, planId);
    throw new Error("方案不存在");
  }

  const { referenceList, textLines } = await loadAssetReferences(projectId, assetIds);
  const prompt = buildImagePrompt(plan, project, preset, textLines);
  const tempRel = `/${projectId}/aso/output/temp-${uuidv4()}.png`;
  const finalRel = `/${projectId}/aso/output/${uuidv4()}.png`;

  try {
    if (!project?.imageModel) throw new Error("请先配置项目 imageModel");
    const aiImage = u.Ai.Image(project.imageModel as `${string}:${string}`);
    await aiImage.run(
      {
        prompt,
        referenceList,
        size: preset.sizeTier,
        aspectRatio: preset.aspectRatio,
      },
      {
        taskClass: "ASO图生成",
        describe: `方案 ${planId} → ${preset.width}x${preset.height}`,
        projectId,
        relatedObjects: JSON.stringify({ projectId, planId, presetId, assetIds }),
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

    await u.db("o_image").where("id", imageId).update({
      state: "已完成",
      filePath: finalRel,
      resolution: `${preset.width}x${preset.height}`,
      prompt,
      errorReason: null,
    });

    await updateOutputState(projectId, imageId, { state: "已完成" });
  } catch (e) {
    const message = u.error(e).message;
    await u.db("o_image").where("id", imageId).update({ state: "生成失败", errorReason: message });
    await updateOutputState(projectId, imageId, { state: "生成失败", errorReason: message });
    throw e;
  } finally {
    releasePlanGeneration(projectId, planId);
  }
}

export { acquirePlanGeneration, releasePlanGeneration } from "./generationLock";

export async function loadSourceMaterial(projectId: number, sourceAssetId: number) {
  const row = await u
    .db("o_assets")
    .leftJoin("o_image", "o_assets.imageId", "o_image.id")
    .where("o_assets.id", sourceAssetId)
    .where("o_assets.projectId", projectId)
    .where("o_assets.type", "aso_material")
    .select("o_assets.id", "o_assets.name", "o_assets.describe", "o_image.filePath", "o_image.id as imageId")
    .first();
  if (!row) {
    const err = new Error("素材不存在");
    (err as any).statusCode = 404;
    throw err;
  }
  if (!row.filePath) throw new Error("仅支持图片素材生成变体");
  return row;
}

export interface VariantJob {
  projectId: number;
  sourceAssetId: number;
  copy: string;
  assetId: number;
  imageId: number;
  index: number;
  total: number;
  done: (state: 1 | -1, reason?: string) => Promise<void>;
}

function buildVariantPrompt(copy: string, artStyle: string | null | undefined, sourceName: string) {
  return [
    "参考附件图片的视觉风格、构图与色调，生成一张新的 ASO 宣传素材图。",
    `创意说明：${copy}`,
    `参考素材：${sourceName}`,
    `画风：${artStyle || "未指定"}`,
    "要求：适合 App Store / Google Play 展示，不要直接复制原图像素。",
  ].join("\n");
}

export async function runVariantJob(job: VariantJob) {
  const { projectId, sourceAssetId, copy, imageId, done } = job;
  const savePath = `/${projectId}/aso/material/variant-${uuidv4()}.png`;

  try {
    const project = await u.db("o_project").where("id", projectId).first();
    if (!project?.imageModel) throw new Error("请先配置项目 imageModel");

    const source = await loadSourceMaterial(projectId, sourceAssetId);
    const dataUrl = await u.oss.getImageBase64(source.filePath);
    const referenceBase64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    const prompt = buildVariantPrompt(copy, project.artStyle, source.name || `#${sourceAssetId}`);

    const aiImage = u.Ai.Image(project.imageModel as `${string}:${string}`);
    await aiImage.run({
      prompt,
      referenceList: [{ type: "image", base64: referenceBase64 }],
      size: "2K",
      aspectRatio: "1:1",
    });
    await aiImage.save(savePath);

    await u.db("o_image").where("id", imageId).update({
      state: "已完成",
      filePath: savePath,
      prompt,
      errorReason: null,
    });
    await done(1);
  } catch (e) {
    const message = u.error(e).message;
    await u.db("o_image").where("id", imageId).update({ state: "生成失败", errorReason: message });
    await done(-1, message);
    throw e;
  }
}

export async function scheduleVariantGeneration(options: {
  projectId: number;
  sourceAssetId: number;
  copy: string;
  count: number;
}): Promise<{ taskIds: number[]; assetIds: number[] }> {
  const { projectId, sourceAssetId, copy, count } = options;
  await assertAsoProject(projectId);
  const releaseVariant = await acquireVariantGeneration(projectId, sourceAssetId);
  let jobsScheduled = 0;
  try {
    const source = await loadSourceMaterial(projectId, sourceAssetId);
    const project = await u.db("o_project").where("id", projectId).first();
    if (!project?.imageModel) throw new Error("请先配置项目 imageModel");

    const modelLabel = project.imageModel.split(/:(.+)/)[1] || project.imageModel;
    const assetIds = nextEntityIds(count);
    const taskIds: number[] = [];
    let remaining = count;
    const onJobFinished = () => {
      remaining -= 1;
      if (remaining <= 0) releaseVariant();
    };

    for (let i = 0; i < count; i++) {
      const assetId = assetIds[i];
      const [imageId] = await u.db("o_image").insert({
        assetsId: assetId,
        type: "aso_material",
        state: "生成中",
      });

      await u.db("o_assets").insert({
        id: assetId,
        projectId,
        type: "aso_material",
        name: `变体-${source.name || sourceAssetId}-${i + 1}`,
        describe: copy,
        remark: `variant:${sourceAssetId}`,
        imageId,
      });

      const done = await u.task(projectId, "ASO参考图变体", modelLabel, {
        describe: `变体 ${i + 1}/${count}（素材 #${sourceAssetId}）`,
        content: { sourceAssetId, assetId, imageId },
      });

      taskIds.push((done as typeof done & { taskId: number }).taskId);
      jobsScheduled += 1;

      setImmediate(() => {
        runVariantJob({
          projectId,
          sourceAssetId,
          copy,
          assetId,
          imageId,
          index: i,
          total: count,
          done,
        })
          .catch((err) => console.error("[ASO参考图变体]", u.error(err).message))
          .finally(onJobFinished);
      });
    }

    return { taskIds, assetIds: assetIds.slice() };
  } catch (e) {
    if (jobsScheduled === 0) releaseVariant();
    throw e;
  }
}
