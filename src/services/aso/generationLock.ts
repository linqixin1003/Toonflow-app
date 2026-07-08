import u from "@/utils";
import { isPlanOutputInProgress } from "./workspace";

const activePlanGenerations = new Set<string>();
const activeVariantSources = new Set<string>();
const activePlanGenerationSessions = new Set<number>();

function planKey(projectId: number, planId: string) {
  return `${projectId}:${planId}`;
}

function variantKey(projectId: number, sourceAssetId: number) {
  return `${projectId}:variant:${sourceAssetId}`;
}

export async function acquirePlanGeneration(projectId: number, planId: string): Promise<void> {
  if (await isPlanOutputInProgress(projectId, planId)) {
    const err = new Error("该方案正在生成中，请稍候");
    (err as any).statusCode = 409;
    throw err;
  }
  const key = planKey(projectId, planId);
  if (activePlanGenerations.has(key)) {
    const err = new Error("该方案正在生成中，请稍候");
    (err as any).statusCode = 409;
    throw err;
  }
  activePlanGenerations.add(key);
}

export function releasePlanGeneration(projectId: number, planId: string): void {
  activePlanGenerations.delete(planKey(projectId, planId));
}

export function acquirePlanGenerationSession(projectId: number): () => void {
  if (activePlanGenerationSessions.has(projectId)) {
    const err = new Error("创意方案正在生成中，请稍候");
    (err as any).statusCode = 409;
    throw err;
  }
  activePlanGenerationSessions.add(projectId);
  return () => activePlanGenerationSessions.delete(projectId);
}

async function assertNoVariantInProgressDb(projectId: number, sourceAssetId: number): Promise<void> {
  const rows = await u
    .db("o_assets")
    .leftJoin("o_image", "o_assets.imageId", "o_image.id")
    .where("o_assets.projectId", projectId)
    .where("o_assets.remark", `variant:${sourceAssetId}`)
    .where("o_image.state", "生成中")
    .select("o_assets.id");
  if (rows.length > 0) {
    const err = new Error("该素材正在生成变体，请稍候");
    (err as any).statusCode = 409;
    throw err;
  }
}

export async function acquireVariantGeneration(projectId: number, sourceAssetId: number): Promise<() => void> {
  await assertNoVariantInProgressDb(projectId, sourceAssetId);
  const key = variantKey(projectId, sourceAssetId);
  if (activeVariantSources.has(key)) {
    const err = new Error("该素材正在生成变体，请稍候");
    (err as any).statusCode = 409;
    throw err;
  }
  activeVariantSources.add(key);
  return () => activeVariantSources.delete(key);
}

/** @deprecated use acquireVariantGeneration */
export async function assertNoVariantInProgress(projectId: number, sourceAssetId: number): Promise<void> {
  await assertNoVariantInProgressDb(projectId, sourceAssetId);
}

export function httpStatusFromError(e: unknown): number {
  const code = (e as { statusCode?: number })?.statusCode;
  if (code === 409 || code === 404) return code;
  return 400;
}
