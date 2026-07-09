import fs from "fs/promises";
import path from "path";
import type { Response } from "express";
import u from "@/utils";
import { sendSseEvent, endSse } from "./sse";
import { AsoPlan, AsoPlanSchema, type AsoWorkspace } from "./types";
import { getWorkspace, patchWorkspace } from "./workspace";
import { acquirePlanGenerationSession } from "./generationLock";
import { extractNumberedPoints, slotLabelsForImagePrompts } from "./numberedPoints";
import { parseTextMaterialSlot, resolveMaterialKind } from "./materialKind";
import type { AsoImagePrompt } from "./types";

import { isUiuxProject } from "@/constants/projectTypes";

const SKILL_PATHS: Record<string, readonly string[]> = {
  aso: ["skills", "aso_plan_generation.md"],
  uiux: ["skills", "uiux_plan_generation.md"],
};

export type PlanMaterial = {
  id: number;
  name: string;
  describe: string;
  materialKind: "image" | "text";
  promptSlot?: number;
  imageBase64?: string;
};

export async function loadSkillPrompt(projectType?: string): Promise<string> {
  const key = isUiuxProject(projectType) ? "uiux" : "aso";
  const skillParts = SKILL_PATHS[key] ?? SKILL_PATHS.aso;
  const skillPath = path.join(u.getPath(), ...skillParts);
  const raw = await fs.readFile(skillPath, "utf-8");
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

export async function loadMaterials(projectId: number, assetIds: number[]): Promise<PlanMaterial[]> {
  if (!assetIds.length) return [];
  const rows = await u
    .db("o_assets")
    .leftJoin("o_image", "o_assets.imageId", "o_image.id")
    .where("o_assets.projectId", projectId)
    .whereIn("o_assets.id", assetIds)
    .where("o_assets.type", "aso_material")
    .select(
      "o_assets.id as id",
      "o_assets.name as name",
      "o_assets.describe as describe",
      "o_assets.remark as remark",
      "o_image.filePath as filePath",
    );

  const materials: PlanMaterial[] = [];
  for (const row of rows) {
    const materialKind: "image" | "text" = resolveMaterialKind(row);
    const item: PlanMaterial = {
      id: row.id,
      name: row.name || "",
      describe: row.describe || "",
      materialKind,
      promptSlot: materialKind === "text" ? parseTextMaterialSlot(row.remark) : undefined,
    };
    if (item.materialKind === "image" && row.filePath) {
      const buf = await u.oss.getFile(row.filePath);
      item.imageBase64 = buf.toString("base64");
    }
    materials.push(item);
  }
  return materials;
}

export type PlanBatchContext = {
  index: number;
  total: number;
  previousTitles: string[];
};

/** Matrix mode with multiple plans: one LLM call per plan to avoid output truncation. */
export function shouldBatchPlanGeneration(planCount: number, imagePromptCount: number): boolean {
  if (imagePromptCount <= 0) return planCount > 1;
  return planCount > 1 || imagePromptCount >= 6 || planCount * imagePromptCount > 12;
}

/** Single plan with many image prompts: split imagePrompts into smaller LLM calls. */
export function shouldChunkSinglePlanImagePrompts(planCount: number, imagePromptCount: number): boolean {
  return planCount === 1 && imagePromptCount >= 6;
}

const IMAGE_PROMPT_CHUNK_SIZE = 4;

function planMaxOutputTokens(imagePromptCount: number): number | undefined {
  if (imagePromptCount <= 0) return undefined;
  return Math.min(16384, Math.max(4096, imagePromptCount * 500 + 1024));
}

export function buildPlanPrompt(
  inputText: string,
  planCount: number,
  imagePromptCount: number,
  materials: PlanMaterial[],
  batch?: PlanBatchContext,
  projectType?: string,
): string {
  const effectivePlanCount = batch ? 1 : planCount;
  const creativeLabel = isUiuxProject(projectType) ? "UI/UX 设计方案" : "ASO 创意方案";
  const screenshotLabel = isUiuxProject(projectType) ? "UI 界面截图" : "ASO 截图";
  const textMaterials = materials.filter((m) => m.materialKind === "text");
  const textBlock = textMaterials.length
    ? `\n文字素材（按出图序号补仓）：\n${textMaterials
        .map((m) => {
          const slotTag = m.promptSlot != null ? `[第${m.promptSlot}张] ` : "";
          return `- ${slotTag}${m.describe}`;
        })
        .join("\n")}`
    : "";
  const imageMaterials = materials.filter((m) => m.materialKind === "image");
  const imageBlock = imageMaterials.length
    ? `\n参考图片素材（${imageMaterials.length} 张，已通过 Vision 附带）：\n${imageMaterials.map((m) => `- ${m.name}: ${m.describe || "无描述"}`).join("\n")}`
    : "";
  const points = extractNumberedPoints(inputText);
  const slotLabels = slotLabelsForImagePrompts(inputText, imagePromptCount);
  const totalPrompts = effectivePlanCount * imagePromptCount;

  const batchBlock = batch
    ? [
        `\n【分批生成 — 第 ${batch.index + 1}/${batch.total} 套】`,
        `本次仅输出 1 套方案（JSON 数组长度 = 1），创意角度须与已有方案明显不同。`,
        batch.previousTitles.length ? `已有方案标题（勿重复）：${batch.previousTitles.join("、")}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const matrixBlock =
    imagePromptCount > 0
      ? [
          batch
            ? `\n【出图提示词 — 本套须含 ${imagePromptCount} 条 imagePrompts】`
            : `\n【出图提示词矩阵 — 方案数 N=${effectivePlanCount} × 每套图数 M=${imagePromptCount} = 共 ${totalPrompts} 条 imagePrompts】`,
          `每套方案必须包含恰好 ${imagePromptCount} 条 imagePrompts（slot 从 1 到 ${imagePromptCount}）。`,
          `每条 imagePrompt 是针对单张${screenshotLabel}的独立出图提示词（画面构图、UI 元素、文案、色调），与对应卖点一一对应。`,
          `每条 prompt 字段须用 English，含画幅（如 9:16）、headline、device mockup 与具体 UI 描述；slot 1 优先 Hero 价值主张。`,
          batch ? "" : `各套方案的同一 slot 可以角度不同，但都必须可独立出图。`,
          `slot 与卖点对应关系：`,
          ...slotLabels.map((label, i) => `  slot ${i + 1}: ${label}`),
        ]
          .filter(Boolean)
          .join("\n")
      : "";

  const pointsBlock = points.length
    ? [
        `\n【卖点条目 — 共 ${points.length} 条】`,
        imagePromptCount > 0
          ? `下列卖点已映射到 imagePrompts 的 slot；请为每个 slot 写出具体出图 prompt。`
          : `说明：下列编号内容是产品卖点/功能要点，不是「方案数量」。方案数量已单独指定为 ${effectivePlanCount}。`,
        ...points.map((p, i) => `${i + 1}. ${p}`),
      ].join("\n")
    : "";

  const outputFormat =
    imagePromptCount > 0
      ? `输出 JSON 数组，每项结构：{ "title": "...", "copy": "方案整体概述", "imagePrompts": [{ "slot": 1, "label": "...", "prompt": "单张出图提示词..." }, ...] }，imagePrompts 长度必须为 ${imagePromptCount}。`
      : `输出 JSON 数组，每项结构：{ "title": "...", "copy": "..." }。`;

  return [
    imagePromptCount > 0
      ? batch
        ? `请生成第 ${batch.index + 1} 套${creativeLabel}（共需 ${batch.total} 套），本套含 ${imagePromptCount} 条出图提示词。`
        : `请生成恰好 ${effectivePlanCount} 套${creativeLabel}，每套含 ${imagePromptCount} 条出图提示词（共 ${totalPrompts} 条 imagePrompts）。`
      : `请生成恰好 ${effectivePlanCount} 套${creativeLabel}（title + copy）。方案数量 = ${effectivePlanCount}（以本字段为准）。`,
    `产品/需求描述：\n${inputText.trim() || "（见参考图片与素材）"}`,
    batchBlock,
    matrixBlock,
    pointsBlock,
    textBlock,
    imageBlock,
    outputFormat,
    `再次确认：JSON 数组长度 = ${effectivePlanCount}${imagePromptCount > 0 ? `；每套 imagePrompts 长度 = ${imagePromptCount}` : ""}。`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildImagePromptChunkPrompt(
  inputText: string,
  title: string,
  copy: string,
  slotStart: number,
  slotEnd: number,
  materials: PlanMaterial[],
  slotLabels: string[],
  projectType?: string,
): string {
  const chunkCount = slotEnd - slotStart + 1;
  const creativeLabel = isUiuxProject(projectType) ? "UI/UX 设计方案" : "ASO 创意方案";
  const screenshotLabel = isUiuxProject(projectType) ? "UI 界面截图" : "ASO 截图";
  const textMaterials = materials.filter((m) => m.materialKind === "text");
  const textBlock = textMaterials.length
    ? `\n文字素材（按出图序号补仓）：\n${textMaterials
        .map((m) => {
          const slotTag = m.promptSlot != null ? `[第${m.promptSlot}张] ` : "";
          return `- ${slotTag}${m.describe}`;
        })
        .join("\n")}`
    : "";
  return [
    `已有${creativeLabel}框架（不要修改 title/copy，仅补充 imagePrompts）：`,
    `title: ${title}`,
    `copy: ${copy}`,
    `\n请仅生成 slot ${slotStart} 至 ${slotEnd} 的 imagePrompts（共 ${chunkCount} 条）。`,
    `每条 imagePrompt 是针对单张${screenshotLabel}的独立出图提示词。`,
    `prompt 字段须用 English，含画幅、headline、device mockup 与具体 UI 描述。`,
    `slot 与卖点对应：`,
    ...slotLabels.slice(slotStart - 1, slotEnd).map((label, i) => `  slot ${slotStart + i}: ${label}`),
    textBlock,
    `输出 JSON 对象：{ "imagePrompts": [{ "slot": ${slotStart}, "label": "...", "prompt": "..." }, ...] }`,
    `imagePrompts 长度必须为 ${chunkCount}，slot 从 ${slotStart} 到 ${slotEnd}。`,
    `产品/需求描述：\n${inputText.trim() || "（见参考图片与素材）"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function parseImagePromptsChunkFromText(
  text: string,
  slotStart: number,
  slotEnd: number,
  slotLabels: string[],
): AsoImagePrompt[] {
  let trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let raw: Array<{ slot?: number; label?: string; prompt?: string }> | undefined;

  const objMatch = trimmed.match(/\{[\s\S]*"imagePrompts"[\s\S]*\}/);
  if (objMatch) {
    try {
      const obj = JSON.parse(objMatch[0]) as { imagePrompts?: typeof raw };
      raw = obj.imagePrompts;
    } catch {
      /* fall through */
    }
  }
  if (!raw?.length) {
    const arrMatch = trimmed.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      try {
        raw = JSON.parse(arrMatch[0]);
      } catch {
        /* fall through */
      }
    }
  }
  if (!raw?.length) {
    throw new Error(`AI 未能解析 slot ${slotStart}-${slotEnd} 的 imagePrompts，请重试`);
  }
  const chunkCount = slotEnd - slotStart + 1;
  const chunkLabels = slotLabels.slice(slotStart - 1, slotEnd);
  const normalized = normalizeImagePrompts(raw, chunkCount, chunkLabels);
  return normalized.map((p, i) => ({ ...p, slot: slotStart + i }));
}

function plansWorkspaceFields(
  options: GeneratePlansOptions,
  merged: AsoPlan[],
  lastPlanGeneration: AsoWorkspace["lastPlanGeneration"],
) {
  return {
    plans: merged,
    planCount: options.planCount,
    imagePromptCount: options.imagePromptCount,
    inputText: options.inputText,
    selectedPlanId: merged[0]?.id ?? null,
    lastPlanGeneration,
  };
}

/**
 * Persist generated plans. Replace mode clears outputs but keeps in-flight
 * ("生成中") records so async edit/generate jobs can still complete.
 */
async function persistPlansWorkspace(
  projectId: number,
  options: GeneratePlansOptions,
  merged: AsoPlan[],
  lastPlanGeneration: AsoWorkspace["lastPlanGeneration"],
): Promise<AsoWorkspace> {
  const fields: Partial<AsoWorkspace> = plansWorkspaceFields(options, merged, lastPlanGeneration);
  if (!options.appendPlans) {
    const current = await getWorkspace(projectId);
    fields.outputs = current.outputs.filter((o) => o.state === "生成中");
  }
  return patchWorkspace(projectId, fields);
}

function normalizeImagePrompts(
  raw: Array<{ slot?: number; label?: string; prompt?: string }> | undefined,
  imagePromptCount: number,
  slotLabels: string[],
): AsoImagePrompt[] {
  if (!imagePromptCount) return [];
  const items = raw ?? [];
  const result: AsoImagePrompt[] = [];
  for (let i = 0; i < imagePromptCount; i++) {
    const slot = i + 1;
    const fromAi = items.find((x) => x.slot === slot) ?? items[i];
    const prompt = (fromAi?.prompt || "").trim();
    result.push({
      slot,
      label: (fromAi?.label || slotLabels[i] || `图${slot}`).trim(),
      prompt,
    });
  }
  const empty = result.filter((p) => !p.prompt);
  if (empty.length) {
    throw new Error(`部分出图提示词为空（缺 ${empty.map((p) => p.slot).join(", ")}），期望每套 ${imagePromptCount} 条`);
  }
  return result;
}

export async function resolvePlanModel(materials: PlanMaterial[]): Promise<"asoVisionAi" | "universalAi"> {
  const hasImages = materials.some((m) => m.materialKind === "image" && m.imageBase64);
  if (!hasImages) return "universalAi";
  const deploy = await u.db("o_agentDeploy").where("key", "asoVisionAi").first();
  if (deploy?.modelName) return "asoVisionAi";
  return "universalAi";
}

export function materialsHaveImages(materials: PlanMaterial[]): boolean {
  return materials.some((m) => m.materialKind === "image" && m.imageBase64);
}

export async function buildPlanMessages(
  systemPrompt: string,
  userPrompt: string,
  materials: PlanMaterial[],
  modelKey: "asoVisionAi" | "universalAi",
): Promise<AiMessage[]> {
  if (modelKey === "universalAi" && materialsHaveImages(materials)) {
    return [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: `${userPrompt}\n\n（提示：参考图片未注入，因未配置 ASO 图片理解模型 asoVisionAi；请在设置中心配置 Vision 模型后重试。）`,
      },
    ];
  }
  return buildVisionMessages(systemPrompt, userPrompt, materials);
}

export async function validatePlanInput(projectId: number, inputText: string, assetIds: number[]): Promise<void> {
  const text = inputText?.trim() || "";
  if (text) return;

  if (assetIds.length > 0) {
    const materials = await loadMaterials(projectId, assetIds);
    if (materials.length === 0) throw new Error("所选素材不存在或已删除");
    const hasContent = materials.some(
      (m) => (m.materialKind === "text" && m.describe.trim()) || (m.materialKind === "image" && m.imageBase64),
    );
    if (!hasContent) throw new Error("所选素材缺少有效内容");
    return;
  }

  throw new Error("请至少提供文本描述或素材");
}

type AiMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "user";
      content: Array<{ type: "text"; text: string } | { type: "image"; image: Buffer }>;
    };

export async function buildVisionMessages(
  systemPrompt: string,
  userPrompt: string,
  materials: PlanMaterial[],
): Promise<AiMessage[]> {
  const imageParts = materials
    .filter((m) => m.materialKind === "image" && m.imageBase64)
    .map((m) => ({ type: "image" as const, image: Buffer.from(m.imageBase64!, "base64") }));

  if (imageParts.length === 0) {
    return [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];
  }

  return [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: [{ type: "text", text: userPrompt }, ...imageParts],
    },
  ];
}

export function parsePlansFromText(
  text: string,
  planCount: number,
  imagePromptCount: number,
  inputText: string,
  planIndexOffset = 0,
): AsoPlan[] {
  const now = Date.now();
  const slotLabels = slotLabelsForImagePrompts(inputText, imagePromptCount);
  let trimmed = text.trim();
  trimmed = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const arr = JSON.parse(jsonMatch[0]) as Array<{
        title?: string;
        copy?: string;
        imagePrompts?: Array<{ slot?: number; label?: string; prompt?: string }>;
      }>;
      const plans = arr.slice(0, planCount).map((item, i) =>
        AsoPlanSchema.parse({
          id: `plan_${now}_${planIndexOffset + i}`,
          title: item.title || `方案${planIndexOffset + i + 1}`,
          copy: item.copy || "",
          imagePrompts: normalizeImagePrompts(item.imagePrompts, imagePromptCount, slotLabels),
          edited: false,
          createdAt: now,
          updatedAt: now,
        }),
      );
      if (plans.length < planCount) {
        throw new Error(`AI 仅返回 ${plans.length} 套方案，期望 ${planCount} 套，请重试或调整描述`);
      }
      return plans;
    } catch (e) {
      if (e instanceof Error && (e.message.includes("期望") || e.message.includes("出图提示词"))) throw e;
      if (imagePromptCount > 0) {
        throw new Error(
          `AI 输出 JSON 不完整（可能被 token 截断）。请减少方案数或每套出图数后重试；多方案矩阵将自动分批生成。`,
        );
      }
      /* fall through */
    }
  }

  const xmlPlans = [...trimmed.matchAll(/<plan[^>]*index="(\d+)"[^>]*>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<copy>([\s\S]*?)<\/copy>[\s\S]*?<\/plan>/gi)];
  if (xmlPlans.length) {
    const plans = xmlPlans.slice(0, planCount).map((match, i) =>
      AsoPlanSchema.parse({
        id: `plan_${now}_${i}`,
        title: match[2].trim() || `方案${i + 1}`,
        copy: match[3].trim(),
        imagePrompts: [],
        edited: false,
        createdAt: now,
        updatedAt: now,
      }),
    );
    if (plans.length < planCount) {
      throw new Error(`AI 仅返回 ${plans.length} 套方案，期望 ${planCount} 套，请重试或调整描述`);
    }
    if (imagePromptCount > 0) {
      throw new Error(`需要 ${imagePromptCount} 条出图提示词/套，XML 降级格式不支持，请重试`);
    }
    return plans;
  }

  if (planCount > 1 || imagePromptCount > 0) {
    throw new Error(`AI 未能解析出 ${planCount} 套结构化方案，请重试或调整描述`);
  }

  return [
    AsoPlanSchema.parse({
      id: `plan_${now}_0`,
      title: "方案1",
      copy: trimmed,
      imagePrompts: [],
      edited: false,
      createdAt: now,
      updatedAt: now,
    }),
  ];
}

const MAX_PLAN_COUNT = 10;

export interface GeneratePlansOptions {
  projectId: number;
  inputText: string;
  planCount: number;
  imagePromptCount: number;
  assetIds: number[];
  appendPlans?: boolean;
  abortSignal?: AbortSignal;
  projectType?: string;
}

export async function resolveAppendContext(projectId: number, planCount: number, appendPlans?: boolean) {
  if (!appendPlans) return { existingPlans: [] as AsoPlan[], planIndexOffset: 0 };
  const workspace = await getWorkspace(projectId);
  const existingPlans = workspace.plans;
  const remaining = MAX_PLAN_COUNT - existingPlans.length;
  if (remaining <= 0) {
    throw new Error(`最多 ${MAX_PLAN_COUNT} 套方案，请先删除部分方案后再追加`);
  }
  if (planCount > remaining) {
    throw new Error(
      `最多 ${MAX_PLAN_COUNT} 套方案，当前已有 ${existingPlans.length} 套，最多再生成 ${remaining} 套`,
    );
  }
  return { existingPlans, planIndexOffset: existingPlans.length };
}

function mergeWithExisting(existingPlans: AsoPlan[], newPlans: AsoPlan[]): AsoPlan[] {
  return [...existingPlans, ...newPlans].slice(0, MAX_PLAN_COUNT);
}

export class PlanGenerationPartialError extends Error {
  partialPlans: AsoPlan[];
  visionFallback: boolean;
  constructor(message: string, partialPlans: AsoPlan[], visionFallback: boolean) {
    super(message);
    this.name = "PlanGenerationPartialError";
    this.partialPlans = partialPlans;
    this.visionFallback = visionFallback;
  }
}

async function generateSinglePlanWithChunkedPrompts(
  options: GeneratePlansOptions,
  planIndexOffset: number,
  materials: PlanMaterial[],
  modelKey: "asoVisionAi" | "universalAi",
  systemPrompt: string,
  hooks?: {
    abortSignal?: AbortSignal;
    onStreamDelta?: (delta: string) => void;
  },
): Promise<AsoPlan> {
  const { inputText, imagePromptCount } = options;
  const slotLabels = slotLabelsForImagePrompts(inputText, imagePromptCount);
  const basePrompt = buildPlanPrompt(inputText, 1, 0, materials, undefined, options.projectType);
  const messages = await buildPlanMessages(systemPrompt, basePrompt, materials, modelKey);

  let skeletonText = "";
  if (hooks?.onStreamDelta) {
    const { textStream } = await u.Ai.Text(modelKey).stream({
      messages: messages as any,
      maxOutputTokens: 2048,
    });
    for await (const chunk of textStream) {
      if (hooks.abortSignal?.aborted) throw new Error("生成已中断");
      skeletonText += chunk;
      hooks.onStreamDelta(chunk);
    }
  } else {
    const result = await u.Ai.Text(modelKey).invoke({
      messages: messages as any,
      abortSignal: hooks?.abortSignal,
      maxOutputTokens: 2048,
    });
    skeletonText = result.text || "";
  }

  const [skeleton] = parsePlansFromText(skeletonText, 1, 0, inputText, planIndexOffset);
  const mergedImagePrompts: AsoImagePrompt[] = [];

  for (let slotStart = 1; slotStart <= imagePromptCount; slotStart += IMAGE_PROMPT_CHUNK_SIZE) {
    if (hooks?.abortSignal?.aborted) throw new Error("生成已中断");
    const slotEnd = Math.min(slotStart + IMAGE_PROMPT_CHUNK_SIZE - 1, imagePromptCount);
    const chunkPrompt = buildImagePromptChunkPrompt(
      inputText,
      skeleton.title,
      skeleton.copy,
      slotStart,
      slotEnd,
      materials,
      slotLabels,
      options.projectType,
    );
    const chunkMessages = await buildPlanMessages(systemPrompt, chunkPrompt, materials, modelKey);
    const chunkCount = slotEnd - slotStart + 1;
    const maxOutputTokens = planMaxOutputTokens(chunkCount);
    const chunkResult = await u.Ai.Text(modelKey).invoke({
      messages: chunkMessages as any,
      abortSignal: hooks?.abortSignal,
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
    });
    mergedImagePrompts.push(
      ...parseImagePromptsChunkFromText(chunkResult.text || "", slotStart, slotEnd, slotLabels),
    );
  }

  return {
    ...skeleton,
    imagePrompts: mergedImagePrompts.sort((a, b) => a.slot - b.slot),
  };
}

async function generateOnePlan(
  options: GeneratePlansOptions,
  planIndex: number,
  previousPlans: AsoPlan[],
  existingPlans: AsoPlan[],
  planIndexOffset: number,
  materials: PlanMaterial[],
  modelKey: "asoVisionAi" | "universalAi",
  systemPrompt: string,
  abortSignal?: AbortSignal,
): Promise<AsoPlan> {
  const { inputText, imagePromptCount } = options;
  const userPrompt = buildPlanPrompt(inputText, 1, imagePromptCount, materials, {
    index: planIndex,
    total: options.planCount,
    previousTitles: [...existingPlans.map((p) => p.title), ...previousPlans.map((p) => p.title)],
  }, options.projectType);
  const messages = await buildPlanMessages(systemPrompt, userPrompt, materials, modelKey);
  const maxOutputTokens = planMaxOutputTokens(imagePromptCount);
  const result = await u.Ai.Text(modelKey).invoke({
    messages: messages as any,
    abortSignal,
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
  });
  const plans = parsePlansFromText(result.text || "", 1, imagePromptCount, inputText, planIndexOffset + planIndex);
  return plans[0];
}

async function runPlanGeneration(options: GeneratePlansOptions): Promise<{
  plans: AsoPlan[];
  modelKey: string;
  visionFallback: boolean;
  existingPlans: AsoPlan[];
}> {
  const { projectId, inputText, planCount, imagePromptCount, assetIds, abortSignal } = options;
  const { existingPlans, planIndexOffset } = await resolveAppendContext(projectId, planCount, options.appendPlans);
  const materials = await loadMaterials(projectId, assetIds);
  const modelKey = await resolvePlanModel(materials);
  const visionFallback = modelKey === "universalAi" && materialsHaveImages(materials);
  const systemPrompt = await loadSkillPrompt(options.projectType);

  if (shouldChunkSinglePlanImagePrompts(planCount, imagePromptCount)) {
    const plan = await generateSinglePlanWithChunkedPrompts(
      options,
      planIndexOffset,
      materials,
      modelKey,
      systemPrompt,
      { abortSignal },
    );
    const plans = options.appendPlans ? mergeWithExisting(existingPlans, [plan]) : [plan];
    return { plans, modelKey, visionFallback, existingPlans };
  }

  if (!shouldBatchPlanGeneration(planCount, imagePromptCount)) {
    const userPrompt = buildPlanPrompt(inputText, planCount, imagePromptCount, materials, undefined, options.projectType);
    const messages = await buildPlanMessages(systemPrompt, userPrompt, materials, modelKey);
    const maxOutputTokens = planMaxOutputTokens(imagePromptCount);
    const result = await u.Ai.Text(modelKey).invoke({
      messages: messages as any,
      abortSignal,
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
    });
    const newPlans = parsePlansFromText(result.text || "", planCount, imagePromptCount, inputText, planIndexOffset);
    const plans = options.appendPlans ? mergeWithExisting(existingPlans, newPlans) : newPlans;
    return { plans, modelKey, visionFallback, existingPlans };
  }

  const newPlans: AsoPlan[] = [];
  for (let i = 0; i < planCount; i++) {
    if (abortSignal?.aborted) break;
    try {
      const plan = await generateOnePlan(
        options,
        i,
        newPlans,
        existingPlans,
        planIndexOffset,
        materials,
        modelKey,
        systemPrompt,
        abortSignal,
      );
      newPlans.push(plan);
    } catch (e) {
      const message = u.error(e).message;
      if (newPlans.length > 0) {
        const partial = options.appendPlans ? mergeWithExisting(existingPlans, newPlans) : newPlans;
        throw new PlanGenerationPartialError(message, partial, visionFallback);
      }
      throw e;
    }
  }
  if (newPlans.length < planCount) {
    const message =
      newPlans.length > 0
        ? `仅生成 ${newPlans.length}/${planCount} 套方案（生成已中断）`
        : `未能生成任何方案，请重试或调整描述`;
    if (newPlans.length > 0) {
      const partial = options.appendPlans ? mergeWithExisting(existingPlans, newPlans) : newPlans;
      throw new PlanGenerationPartialError(message, partial, visionFallback);
    }
    throw new Error(message);
  }
  const plans = options.appendPlans ? mergeWithExisting(existingPlans, newPlans) : newPlans;
  return { plans, modelKey, visionFallback, existingPlans };
}

export async function generatePlansSync(
  options: GeneratePlansOptions,
): Promise<{ plans: AsoPlan[]; visionFallback: boolean }> {
  const { projectId, inputText, planCount, assetIds } = options;
  const releaseSession = acquirePlanGenerationSession(projectId);
  try {
    await patchWorkspace(projectId, {
      lastPlanGeneration: { status: "generating", updatedAt: Date.now() },
    });

    const taskLabel = isUiuxProject(options.projectType) ? "UIUX方案生成" : "ASO方案生成";
    const done = await u.task(projectId, taskLabel, "asoPlan", {
      describe: `生成 ${planCount} 套创意方案${options.imagePromptCount ? ` × ${options.imagePromptCount} 条出图提示词` : ""}`,
      content: { planCount, imagePromptCount: options.imagePromptCount, assetIds },
    });

    try {
      const { plans, visionFallback } = await runPlanGeneration(options);
      await persistPlansWorkspace(projectId, options, plans, { status: "done", updatedAt: Date.now() });
      await done(1);
      return { plans, visionFallback };
    } catch (e) {
      if (e instanceof PlanGenerationPartialError) {
        await persistPlansWorkspace(projectId, options, e.partialPlans, {
          status: "error",
          errorReason: e.message,
          updatedAt: Date.now(),
        });
        await done(-1, e.message);
        return { plans: e.partialPlans, visionFallback: e.visionFallback };
      }
      const message = u.error(e).message;
      await patchWorkspace(projectId, {
        lastPlanGeneration: { status: "error", errorReason: message, updatedAt: Date.now() },
      });
      await done(-1, message);
      throw e;
    }
  } finally {
    releaseSession();
  }
}

export async function streamPlansToSse(res: Response, req: import("express").Request, options: GeneratePlansOptions) {
  const { projectId, planCount, imagePromptCount } = options;
  const releaseSession = acquirePlanGenerationSession(projectId);

  await patchWorkspace(projectId, {
    lastPlanGeneration: { status: "generating", updatedAt: Date.now() },
  });

  const streamTaskLabel = isUiuxProject(options.projectType) ? "UIUX方案生成" : "ASO方案生成";
  const done = await u.task(projectId, streamTaskLabel, "asoPlan", {
    describe: `流式生成 ${planCount} 套创意方案${imagePromptCount ? ` × ${imagePromptCount} 条出图提示词` : ""}`,
    content: { planCount, imagePromptCount, assetIds: options.assetIds },
  });

  let aborted = false;
  const abortController = new AbortController();
  req.on("close", () => {
    aborted = true;
    abortController.abort();
  });

  try {
    const { existingPlans, planIndexOffset } = await resolveAppendContext(
      projectId,
      planCount,
      options.appendPlans,
    );

    const finishPartial = async (
      newPlans: AsoPlan[],
      visionFallback: boolean,
      taskMessage?: string,
    ) => {
      const merged = options.appendPlans ? mergeWithExisting(existingPlans, newPlans) : newPlans;
      const workspace = await persistPlansWorkspace(projectId, options, merged, {
        status: newPlans.length === planCount ? "done" : "error",
        errorReason: newPlans.length < planCount ? taskMessage : undefined,
        updatedAt: Date.now(),
      });
      await done(newPlans.length === planCount ? 1 : -1, taskMessage);
      sendSseEvent(res, "all_done", {
        plans: merged,
        workspace,
        visionFallback,
        partial: newPlans.length < planCount,
        appendPlans: options.appendPlans ?? false,
      });
      endSse(res);
    };
    const materials = await loadMaterials(projectId, options.assetIds);
    const modelKey = await resolvePlanModel(materials);
    const visionFallback = modelKey === "universalAi" && materialsHaveImages(materials);
    const systemPrompt = await loadSkillPrompt(options.projectType);
    const taskLabel = isUiuxProject(options.projectType) ? "UIUX方案生成" : "ASO方案生成";
    const useBatch = shouldBatchPlanGeneration(planCount, imagePromptCount);
    const useChunk = shouldChunkSinglePlanImagePrompts(planCount, imagePromptCount);
    const newPlans: AsoPlan[] = [];

    if (useChunk) {
      sendSseEvent(res, "plan_start", {
        index: planIndexOffset,
        total: planCount,
        modelKey,
        visionFallback,
        batched: true,
        appendPlans: options.appendPlans ?? false,
        planIndexOffset,
      });

      try {
        const plan = await generateSinglePlanWithChunkedPrompts(
          options,
          planIndexOffset,
          materials,
          modelKey,
          systemPrompt,
          {
            abortSignal: abortController.signal,
            onStreamDelta: (delta) => {
              sendSseEvent(res, "plan_delta", { index: planIndexOffset, field: "copy", delta });
            },
          },
        );
        newPlans.push(plan);
        sendSseEvent(res, "plan_done", { index: planIndexOffset, plan });
      } catch (e) {
        const message = u.error(e).message;
        if (newPlans.length > 0) {
          await finishPartial(newPlans, visionFallback, message);
          return;
        }
        throw e;
      }

      if (aborted) {
        await finishPartial(newPlans, visionFallback, "客户端断开连接");
        return;
      }

      const merged = options.appendPlans ? mergeWithExisting(existingPlans, newPlans) : newPlans;
      const workspace = await persistPlansWorkspace(projectId, options, merged, {
        status: "done",
        updatedAt: Date.now(),
      });
      await done(1);
      sendSseEvent(res, "all_done", { plans: merged, workspace, visionFallback, appendPlans: options.appendPlans ?? false });
      endSse(res);
      return;
    }

    if (!useBatch) {
      const userPrompt = buildPlanPrompt(options.inputText, planCount, imagePromptCount, materials, undefined, options.projectType);
      const messages = await buildPlanMessages(systemPrompt, userPrompt, materials, modelKey);
      const maxOutputTokens = planMaxOutputTokens(imagePromptCount);

      sendSseEvent(res, "plan_start", {
        index: planIndexOffset,
        total: planCount,
        modelKey,
        visionFallback,
        batched: false,
        appendPlans: options.appendPlans ?? false,
        planIndexOffset,
      });

      const { textStream } = await u.Ai.Text(modelKey).stream({
        messages: messages as any,
        ...(maxOutputTokens ? { maxOutputTokens } : {}),
      });

      let fullText = "";
      for await (const chunk of textStream) {
        if (aborted) break;
        fullText += chunk;
        sendSseEvent(res, "plan_delta", { index: planIndexOffset, field: "copy", delta: chunk });
      }

      if (aborted) {
        await done(-1, "客户端断开连接");
        endSse(res);
        return;
      }

      const parsed = parsePlansFromText(fullText, planCount, imagePromptCount, options.inputText, planIndexOffset);
      for (let index = 0; index < parsed.length; index++) {
        sendSseEvent(res, "plan_done", { index: planIndexOffset + index, plan: parsed[index] });
      }

      const merged = options.appendPlans ? mergeWithExisting(existingPlans, parsed) : parsed;
      const workspace = await persistPlansWorkspace(projectId, options, merged, {
        status: "done",
        updatedAt: Date.now(),
      });

      await done(1);
      sendSseEvent(res, "all_done", { plans: merged, workspace, visionFallback, appendPlans: options.appendPlans ?? false });
      endSse(res);
      return;
    }

    for (let i = 0; i < planCount; i++) {
      if (aborted) break;

      sendSseEvent(res, "plan_start", {
        index: planIndexOffset + i,
        total: planCount,
        modelKey,
        visionFallback,
        batched: true,
        appendPlans: options.appendPlans ?? false,
        planIndexOffset,
      });

      const userPrompt = buildPlanPrompt(options.inputText, 1, imagePromptCount, materials, {
        index: i,
        total: planCount,
        previousTitles: [...existingPlans.map((p) => p.title), ...newPlans.map((p) => p.title)],
      }, options.projectType);
      const messages = await buildPlanMessages(systemPrompt, userPrompt, materials, modelKey);
      const maxOutputTokens = planMaxOutputTokens(imagePromptCount);

      const { textStream } = await u.Ai.Text(modelKey).stream({
        messages: messages as any,
        ...(maxOutputTokens ? { maxOutputTokens } : {}),
      });

      let fullText = "";
      for await (const chunk of textStream) {
        if (aborted) break;
        fullText += chunk;
        sendSseEvent(res, "plan_delta", { index: planIndexOffset + i, field: "copy", delta: chunk });
      }

      if (aborted) break;

      try {
        const [plan] = parsePlansFromText(fullText, 1, imagePromptCount, options.inputText, planIndexOffset + i);
        newPlans.push(plan);
        sendSseEvent(res, "plan_done", { index: planIndexOffset + i, plan });
      } catch (e) {
        const message = u.error(e).message;
        if (newPlans.length > 0) {
          await finishPartial(newPlans, visionFallback, message);
          return;
        }
        throw e;
      }
    }

    if (aborted) {
      if (newPlans.length > 0) {
        await finishPartial(newPlans, visionFallback, "客户端断开连接");
        return;
      }
      await done(-1, "客户端断开连接");
      endSse(res);
      return;
    }

    const merged = options.appendPlans ? mergeWithExisting(existingPlans, newPlans) : newPlans;
    const workspace = await persistPlansWorkspace(projectId, options, merged, {
      status: "done",
      updatedAt: Date.now(),
    });

    await done(1);
    sendSseEvent(res, "all_done", { plans: merged, workspace, visionFallback, appendPlans: options.appendPlans ?? false });
    endSse(res);
  } catch (e) {
    const message = u.error(e).message;
    await patchWorkspace(projectId, {
      lastPlanGeneration: { status: "error", errorReason: message, updatedAt: Date.now() },
    });
    await done(-1, message);
    sendSseEvent(res, "error", { message });
    endSse(res);
  } finally {
    releaseSession();
  }
}
