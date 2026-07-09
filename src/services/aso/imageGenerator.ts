import { v4 as uuidv4 } from "uuid";
import u from "@/utils";
import { getPresetById, getDefaultPreset, type AsoSizePreset } from "@/constants/asoSizePresets";
import { getUiuxPresetById, getDefaultUiuxPreset } from "@/constants/uiuxSizePresets";
import { isUiuxProject } from "@/constants/projectTypes";
import { getArtPrompt } from "@/utils/getArtPrompt";
import { resizeImage } from "@/utils/image";
import path from "path";
import getPath from "@/utils/getPath";
import {
  appendOutput,
  assertCreativeProject,
  updateOutputState,
  getWorkspace,
} from "./workspace";
import { acquireOutputGeneration, releaseOutputGeneration, acquireVariantGeneration } from "./generationLock";
import { nextEntityId, nextEntityIds } from "./id";
import { isTextMaterialRemark, parseTextMaterialSlot } from "./materialKind";
import type { AsoPlan } from "./types";

export function resolvePreset(presetId?: string, projectType?: string): AsoSizePreset {
  if (isUiuxProject(projectType)) {
    return getUiuxPresetById(presetId || "") ?? getDefaultUiuxPreset();
  }
  return getPresetById(presetId || "") ?? getDefaultPreset();
}

export async function loadAssetReferences(projectId: number, assetIds: number[], promptSlot?: number) {
  const rows = await u
    .db("o_assets")
    .leftJoin("o_image", "o_assets.imageId", "o_image.id")
    .where("o_assets.projectId", projectId)
    .whereIn("o_assets.id", assetIds)
    .where("o_assets.type", "aso_material")
    .select("o_assets.id", "o_assets.describe", "o_assets.remark", "o_image.filePath");

  const referenceList: { type: "image"; base64: string }[] = [];
  const textLines: string[] = [];

  for (const row of rows) {
    if (row.filePath) {
      const dataUrl = await u.oss.getImageBase64(row.filePath);
      referenceList.push({ type: "image", base64: dataUrl });
    } else if (row.describe && isTextMaterialRemark(row.remark)) {
      const slot = parseTextMaterialSlot(row.remark);
      if (promptSlot != null) {
        if (slot == null || slot !== promptSlot) continue;
      }
      textLines.push(row.describe);
    }
  }

  return { referenceList, textLines };
}

function resolveArtStyleDescription(artStyle: string | null | undefined): string {
  const raw = artStyle?.trim();
  if (!raw) return "未指定";
  const fromManual = getArtPrompt(raw, "art_skills", "art_scene").trim();
  if (fromManual && fromManual !== "无") return fromManual;
  const prefixOnly = getArtPrompt(raw, "art_skills", "prefix").trim();
  if (prefixOnly) return prefixOnly;
  return raw;
}

export function buildImagePrompt(
  plan: AsoPlan,
  project: any,
  preset: AsoSizePreset,
  textLines: string[],
  promptSlot?: number,
  projectType?: string,
): string {
  const textBlock = textLines.length ? `\n素材描述：\n${textLines.map((t) => `- ${t}`).join("\n")}` : "";
  const outputLabel = isUiuxProject(projectType) ? "UI/UX 界面设计稿" : "ASO 商店宣传图";
  let creativeBody: string;
  if (promptSlot != null && plan.imagePrompts?.length) {
    const ip = plan.imagePrompts.find((p) => p.slot === promptSlot);
    if (ip) {
      const promptLabel = isUiuxProject(projectType) ? "UI/UX 界面设计稿" : "ASO 宣传图";
      creativeBody = [
        `本张${promptLabel}出图提示词 [${ip.slot}]${ip.label ? ` ${ip.label}` : ""}:`,
        ip.prompt,
        plan.copy ? `\n方案正文参考：${plan.copy}` : "",
      ].join("\n");
    } else {
      creativeBody = `创意正文：${plan.copy}`;
    }
  } else if (plan.imagePrompts?.length) {
    creativeBody = `\n分镜出图提示词（共 ${plan.imagePrompts.length} 张）：\n${plan.imagePrompts
      .map((p) => `- [${p.slot}] ${p.label || "图" + p.slot}: ${p.prompt}`)
      .join("\n")}`;
  } else {
    creativeBody = `创意正文：${plan.copy}`;
  }
  return [
    `生成${outputLabel}，尺寸目标 ${preset.width}x${preset.height}（${preset.label}）。`,
    `画风：${resolveArtStyleDescription(project.artStyle)}`,
    `创意标题：${plan.title}`,
    creativeBody,
    textBlock,
    isUiuxProject(projectType)
      ? "要求：高保真移动端 UI 设计，遵循平台设计规范，像素级精确，无占位符文本。"
      : "要求：清晰可读的文字排版，适合 App Store / Google Play 展示，无违规内容。",
  ].join("\n");
}

export interface GenerateAsoImageJob {
  projectId: number;
  planId: string;
  presetId: string;
  assetIds: number[];
  outputAssetId: number;
  imageId: number;
  promptSlot?: number;
  projectType?: string;
}

export interface ScheduleAsoOutputParams {
  projectId: number;
  planId: string;
  presetId: string;
  assetIds: number[];
  promptSlot?: number;
  promptLabel?: string;
  projectType?: string;
}

export interface ScheduledAsoOutput {
  outputAssetId: number;
  imageId: number;
  state: "生成中";
  presetId: string;
  width: number;
  height: number;
  promptSlot?: number;
  promptLabel?: string;
}

export async function scheduleAsoOutputGeneration(params: ScheduleAsoOutputParams): Promise<ScheduledAsoOutput> {
  const { projectId, planId, presetId, promptSlot, promptLabel, projectType } = params;
  await acquireOutputGeneration(projectId, planId, promptSlot);

  let outputAssetId: number | undefined;
  let imageId: number | undefined;

  try {
    const preset = resolvePreset(presetId, projectType);
    const workspace = await getWorkspace(projectId);
    const plan = workspace.plans.find((p) => p.id === planId);
    if (!plan) {
      throw new Error("方案不存在");
    }

    const slotSuffix = promptSlot != null ? `-s${promptSlot}` : "";
    outputAssetId = nextEntityId();
    const outputLabel = isUiuxProject(projectType) ? "UIUX" : "ASO";
    await u.db("o_assets").insert({
      id: outputAssetId,
      projectId,
      type: "aso_output",
      name: `${outputLabel}-${preset.id}${slotSuffix}-${outputAssetId}`,
      remark: planId,
      prompt: plan.copy,
      describe: promptLabel?.trim() || plan.title,
    });

    const insertedImageIds = await u.db("o_image").insert({
      assetsId: outputAssetId,
      type: "aso_output",
      state: "生成中",
      resolution: `${preset.width}x${preset.height}`,
    });
    imageId = insertedImageIds[0];
    if (imageId == null) {
      throw new Error("创建出图记录失败");
    }

    await u.db("o_assets").where("id", outputAssetId).update({ imageId });

    await appendOutput(projectId, {
      planId,
      assetId: outputAssetId,
      imageId,
      presetId: preset.id,
      width: preset.width,
      height: preset.height,
      state: "生成中",
      promptSlot,
      promptLabel: promptLabel?.trim() || undefined,
      createdAt: Date.now(),
    });

    return {
      outputAssetId,
      imageId,
      state: "生成中",
      presetId: preset.id,
      width: preset.width,
      height: preset.height,
      promptSlot,
      promptLabel: promptLabel?.trim() || undefined,
    };
  } catch (e) {
    if (imageId != null) {
      await u.db("o_image").where("id", imageId).delete().catch(() => undefined);
    }
    if (outputAssetId != null) {
      await u.db("o_assets").where("id", outputAssetId).delete().catch(() => undefined);
    }
    releaseOutputGeneration(projectId, planId, promptSlot);
    throw e;
  }
}

export async function runGenerateJob(job: GenerateAsoImageJob) {
  const { projectId, planId, presetId, assetIds, imageId, promptSlot, projectType } = job;
  const preset = resolvePreset(presetId, projectType);
  const project = await u.db("o_project").where("id", projectId).first();
  const workspace = await getWorkspace(projectId);
  const plan = workspace.plans.find((p) => p.id === planId);
  if (!plan) {
    releaseOutputGeneration(projectId, planId, promptSlot);
    throw new Error("方案不存在");
  }

  const { referenceList, textLines } = await loadAssetReferences(projectId, assetIds, promptSlot);
  const prompt = buildImagePrompt(plan, project, preset, textLines, promptSlot, projectType);
  const tempRel = `/${projectId}/aso/output/temp-${uuidv4()}.png`;
  const finalRel = `/${projectId}/aso/output/${uuidv4()}.png`;

  try {
    if (!project?.imageModel) throw new Error("请先配置项目 imageModel");
    const aiImage = u.Ai.Image(project.imageModel as `${string}:${string}`);
    const imgTaskLabel = isUiuxProject(projectType) ? "UIUX图生成" : "ASO图生成";
    await aiImage.run(
      {
        prompt,
        referenceList,
        size: preset.sizeTier,
        aspectRatio: preset.aspectRatio,
      },
      {
        taskClass: imgTaskLabel,
        describe: `方案 ${planId} → ${preset.width}x${preset.height}`,
        projectId,
        relatedObjects: JSON.stringify({ projectId, planId, presetId, assetIds, promptSlot }),
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
      errorReason: null,
    });

    await updateOutputState(projectId, imageId, { state: "已完成" });
  } catch (e) {
    const message = u.error(e).message;
    await u.db("o_image").where("id", imageId).update({ state: "生成失败", errorReason: message });
    await updateOutputState(projectId, imageId, { state: "生成失败", errorReason: message });
    throw e;
  } finally {
    releaseOutputGeneration(projectId, planId, promptSlot);
  }
}

export { acquireOutputGeneration, releaseOutputGeneration } from "./generationLock";

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

function buildVariantPrompt(copy: string, artStyle: string | null | undefined, sourceName: string, projectType?: string) {
  const outputLabel = isUiuxProject(projectType) ? "UI/UX 设计素材图" : "ASO 宣传素材图";
  const displayTarget = isUiuxProject(projectType)
    ? "适合移动端 UI 设计展示，不要直接复制原图像素。"
    : "适合 App Store / Google Play 展示，不要直接复制原图像素。";
  return [
    `参考附件图片的视觉风格、构图与色调，生成一张新的${outputLabel}。`,
    `创意说明：${copy}`,
    `参考素材：${sourceName}`,
    `画风：${resolveArtStyleDescription(artStyle)}`,
    `要求：${displayTarget}`,
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
    const prompt = buildVariantPrompt(copy, project.artStyle, source.name || `#${sourceAssetId}`, project.projectType ?? undefined);

    const aiImage = u.Ai.Image(project.imageModel as `${string}:${string}`);
    await aiImage.run({
      prompt,
      referenceList: [{ type: "image", base64: dataUrl }],
      size: "2K",
      aspectRatio: "1:1",
    });
    await aiImage.save(savePath);

    await u.db("o_image").where("id", imageId).update({
      state: "已完成",
      filePath: savePath,
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
  await assertCreativeProject(projectId);
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

      const variantTaskLabel = isUiuxProject(project.projectType) ? "UIUX参考图变体" : "ASO参考图变体";
      const done = await u.task(projectId, variantTaskLabel, modelLabel, {
        describe: `变体 ${i + 1}/${count}（素材 #${sourceAssetId}）`,
        content: { sourceAssetId, assetId, imageId },
      });

      taskIds.push((done as typeof done & { taskId: number }).taskId);
      jobsScheduled += 1;

      setTimeout(() => {
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
      }, i * 800);
    }

    return { taskIds, assetIds: assetIds.slice() };
  } catch (e) {
    if (jobsScheduled === 0) releaseVariant();
    throw e;
  }
}
