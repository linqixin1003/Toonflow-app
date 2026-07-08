import fs from "fs/promises";
import path from "path";
import type { Response } from "express";
import u from "@/utils";
import { sendSseEvent, endSse } from "./sse";
import { AsoPlan, AsoPlanSchema } from "./types";
import { patchWorkspace } from "./workspace";

const SKILL_PATH = ["skills", "aso_plan_generation.md"] as const;

export type PlanMaterial = {
  id: number;
  name: string;
  describe: string;
  materialKind: "image" | "text";
  imageBase64?: string;
};

export async function loadSkillPrompt(): Promise<string> {
  const skillPath = path.join(u.getPath(), ...SKILL_PATH);
  return fs.readFile(skillPath, "utf-8");
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
    const materialKind: "image" | "text" = row.filePath ? "image" : "text";
    const item: PlanMaterial = {
      id: row.id,
      name: row.name || "",
      describe: row.describe || "",
      materialKind,
    };
    if (item.materialKind === "image" && row.filePath) {
      const buf = await u.oss.getFile(row.filePath);
      item.imageBase64 = buf.toString("base64");
    }
    materials.push(item);
  }
  return materials;
}

export function buildPlanPrompt(inputText: string, planCount: number, materials: PlanMaterial[]): string {
  const textMaterials = materials.filter((m) => m.materialKind === "text");
  const textBlock = textMaterials.length
    ? `\n文字素材：\n${textMaterials.map((m) => `- ${m.name}: ${m.describe}`).join("\n")}`
    : "";
  const imageMaterials = materials.filter((m) => m.materialKind === "image");
  const imageBlock = imageMaterials.length
    ? `\n参考图片素材（${imageMaterials.length} 张，已通过 Vision 附带）：\n${imageMaterials.map((m) => `- ${m.name}: ${m.describe || "无描述"}`).join("\n")}`
    : "";
  return [
    `请生成 ${planCount} 套 ASO 创意方案（title + copy）。`,
    `产品/需求描述：\n${inputText.trim() || "（见参考图片与素材）"}`,
    textBlock,
    imageBlock,
    `\n方案数量：${planCount}`,
  ]
    .filter(Boolean)
    .join("\n");
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

export function parsePlansFromText(text: string, planCount: number): AsoPlan[] {
  const now = Date.now();
  const trimmed = text.trim();

  const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const arr = JSON.parse(jsonMatch[0]) as Array<{ title?: string; copy?: string }>;
      const plans = arr.slice(0, planCount).map((item, i) =>
        AsoPlanSchema.parse({
          id: `plan_${now}_${i}`,
          title: item.title || `方案${i + 1}`,
          copy: item.copy || "",
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
      if (e instanceof Error && e.message.includes("期望")) throw e;
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
        edited: false,
        createdAt: now,
        updatedAt: now,
      }),
    );
    if (plans.length < planCount) {
      throw new Error(`AI 仅返回 ${plans.length} 套方案，期望 ${planCount} 套，请重试或调整描述`);
    }
    return plans;
  }

  if (planCount > 1) {
    throw new Error(`AI 未能解析出 ${planCount} 套结构化方案，请重试或调整描述`);
  }

  return [
    AsoPlanSchema.parse({
      id: `plan_${now}_0`,
      title: "方案1",
      copy: trimmed,
      edited: false,
      createdAt: now,
      updatedAt: now,
    }),
  ];
}

export interface GeneratePlansOptions {
  projectId: number;
  inputText: string;
  planCount: number;
  assetIds: number[];
  abortSignal?: AbortSignal;
}

async function runPlanGeneration(options: GeneratePlansOptions): Promise<{
  plans: AsoPlan[];
  modelKey: string;
  visionFallback: boolean;
}> {
  const { projectId, inputText, planCount, assetIds, abortSignal } = options;
  const materials = await loadMaterials(projectId, assetIds);
  const modelKey = await resolvePlanModel(materials);
  const visionFallback = modelKey === "universalAi" && materialsHaveImages(materials);
  const systemPrompt = await loadSkillPrompt();
  const userPrompt = buildPlanPrompt(inputText, planCount, materials);
  const messages = await buildPlanMessages(systemPrompt, userPrompt, materials, modelKey);

  const result = await u.Ai.Text(modelKey).invoke({
    messages: messages as any,
    abortSignal,
  });

  const plans = parsePlansFromText(result.text || "", planCount);
  return { plans, modelKey, visionFallback };
}

export async function generatePlansSync(
  options: GeneratePlansOptions,
): Promise<{ plans: AsoPlan[]; visionFallback: boolean }> {
  const { projectId, inputText, planCount, assetIds } = options;
  await patchWorkspace(projectId, {
    lastPlanGeneration: { status: "generating", updatedAt: Date.now() },
  });

  const done = await u.task(projectId, "ASO方案生成", "asoPlan", {
    describe: `生成 ${planCount} 套创意方案`,
    content: { planCount, assetIds },
  });

  try {
    const { plans, visionFallback } = await runPlanGeneration(options);
    await patchWorkspace(projectId, {
      plans,
      planCount,
      inputText,
      selectedPlanId: plans[0]?.id ?? null,
      lastPlanGeneration: { status: "done", updatedAt: Date.now() },
    });
    await done(1);
    return { plans, visionFallback };
  } catch (e) {
    const message = u.error(e).message;
    await patchWorkspace(projectId, {
      lastPlanGeneration: { status: "error", errorReason: message, updatedAt: Date.now() },
    });
    await done(-1, message);
    throw e;
  }
}

export async function streamPlansToSse(res: Response, req: import("express").Request, options: GeneratePlansOptions) {
  const { projectId, planCount } = options;

  await patchWorkspace(projectId, {
    lastPlanGeneration: { status: "generating", updatedAt: Date.now() },
  });

  const done = await u.task(projectId, "ASO方案生成", "asoPlan", {
    describe: `流式生成 ${planCount} 套创意方案`,
    content: { planCount, assetIds: options.assetIds },
  });

  let aborted = false;
  req.on("close", () => {
    aborted = true;
  });

  try {
    const materials = await loadMaterials(projectId, options.assetIds);
    const modelKey = await resolvePlanModel(materials);
    const visionFallback = modelKey === "universalAi" && materialsHaveImages(materials);
    const systemPrompt = await loadSkillPrompt();
    const userPrompt = buildPlanPrompt(options.inputText, planCount, materials);
    const messages = await buildPlanMessages(systemPrompt, userPrompt, materials, modelKey);

    sendSseEvent(res, "plan_start", { index: 0, total: planCount, modelKey, visionFallback });

    const { textStream } = await u.Ai.Text(modelKey).stream({
      messages: messages as any,
    });

    let fullText = "";
    for await (const chunk of textStream) {
      if (aborted) break;
      fullText += chunk;
      sendSseEvent(res, "plan_delta", { index: 0, field: "copy", delta: chunk });
    }

    if (aborted) {
      await done(-1, "客户端断开连接");
      endSse(res);
      return;
    }

    const plans = parsePlansFromText(fullText, planCount);
    for (let index = 0; index < plans.length; index++) {
      sendSseEvent(res, "plan_done", { index, plan: plans[index] });
    }

    const workspace = await patchWorkspace(projectId, {
      plans,
      planCount,
      inputText: options.inputText,
      selectedPlanId: plans[0]?.id ?? null,
      lastPlanGeneration: { status: "done", updatedAt: Date.now() },
    });

    await done(1);
    sendSseEvent(res, "all_done", { plans, workspace, visionFallback });
    endSse(res);
  } catch (e) {
    const message = u.error(e).message;
    await patchWorkspace(projectId, {
      lastPlanGeneration: { status: "error", errorReason: message, updatedAt: Date.now() },
    });
    await done(-1, message);
    sendSseEvent(res, "error", { message });
    endSse(res);
  }
}
