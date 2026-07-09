import u from "@/utils";
import { isPlanOutputInProgress } from "./workspace";

const activePlanGenerations = new Set<string>();
const activeOutputGenerations = new Set<string>();
const activeVariantSources = new Set<string>();
const activePlanGenerationSessions = new Set<number>();
const activeOutputEdits = new Set<string>();

function planKey(projectId: number, planId: string) {
  return `${projectId}:${planId}`;
}

function outputGenKey(projectId: number, planId: string, promptSlot?: number) {
  const slotPart = promptSlot != null ? `slot:${promptSlot}` : "legacy";
  return `${projectId}:${planId}:${slotPart}`;
}

function variantKey(projectId: number, sourceAssetId: number) {
  return `${projectId}:variant:${sourceAssetId}`;
}

/** @deprecated Prefer acquireOutputGeneration for per-slot ASO image jobs. */
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

export async function isOutputSlotInProgress(
  projectId: number,
  planId: string,
  promptSlot?: number,
): Promise<boolean> {
  const { getWorkspace } = await import("./workspace");
  const workspace = await getWorkspace(projectId);
  const matching = workspace.outputs.filter(
    (o) =>
      o.planId === planId &&
      (promptSlot != null ? o.promptSlot === promptSlot : o.promptSlot == null),
  );
  if (matching.some((o) => o.state === "生成中")) return true;
  const imageIds = matching.map((o) => o.imageId);
  if (imageIds.length === 0) return false;
  const rows = await u.db("o_image").whereIn("id", imageIds).andWhere("state", "生成中");
  return rows.length > 0;
}

export async function acquireOutputGeneration(
  projectId: number,
  planId: string,
  promptSlot?: number,
): Promise<void> {
  if (await isOutputSlotInProgress(projectId, planId, promptSlot)) {
    const err = new Error(
      promptSlot != null ? `分镜 ${promptSlot} 正在生成中，请稍候` : "该方案正在生成中，请稍候",
    );
    (err as any).statusCode = 409;
    throw err;
  }
  const key = outputGenKey(projectId, planId, promptSlot);
  if (activeOutputGenerations.has(key)) {
    const err = new Error(
      promptSlot != null ? `分镜 ${promptSlot} 正在生成中，请稍候` : "该方案正在生成中，请稍候",
    );
    (err as any).statusCode = 409;
    throw err;
  }
  activeOutputGenerations.add(key);
}

export function releaseOutputGeneration(projectId: number, planId: string, promptSlot?: number): void {
  activeOutputGenerations.delete(outputGenKey(projectId, planId, promptSlot));
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

export function acquireOutputEdit(projectId: number, imageId: number): () => void {
  const key = `${projectId}:edit:${imageId}`;
  if (activeOutputEdits.has(key)) {
    const err = new Error("该成品正在编辑中，请稍候");
    (err as any).statusCode = 409;
    throw err;
  }
  activeOutputEdits.add(key);
  return () => releaseOutputEdit(projectId, imageId);
}

export function releaseOutputEdit(projectId: number, imageId: number): void {
  activeOutputEdits.delete(`${projectId}:edit:${imageId}`);
}

const editTagQueues = new Map<string, Promise<void>>();

/**
 * Serializes editTag allocation per projectId+planId+promptSlot so concurrent
 * edits on different source images of the same slot never pick the same tag.
 */
export function withEditTagLock<T>(
  projectId: number,
  planId: string | undefined,
  promptSlot: number | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const key = `${projectId}:edittag:${planId ?? "none"}:${promptSlot ?? "legacy"}`;
  const prev = editTagQueues.get(key) ?? Promise.resolve();
  const result = prev.then(fn);
  const settled = result.then(
    () => undefined,
    () => undefined,
  );
  editTagQueues.set(key, settled);
  void settled.then(() => {
    if (editTagQueues.get(key) === settled) editTagQueues.delete(key);
  });
  return result;
}

export function httpStatusFromError(e: unknown): number {
  const code = (e as { statusCode?: number })?.statusCode;
  if (code === 409 || code === 404) return code;
  return 400;
}
