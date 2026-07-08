import u from "@/utils";
import { isPlanOutputInProgress } from "./workspace";

const activePlanGenerations = new Set<string>();

function planKey(projectId: number, planId: string) {
  return `${projectId}:${planId}`;
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

export async function assertNoVariantInProgress(projectId: number, sourceAssetId: number): Promise<void> {
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
