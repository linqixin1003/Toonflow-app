import u from "@/utils";
import { isAsoProject } from "@/constants/projectTypes";
import { nextEntityId } from "./id";
import {
  AsoOutputRecord,
  AsoPlan,
  AsoPlanSchema,
  AsoWorkspace,
  AsoWorkspaceSchema,
  createDefaultAsoWorkspace,
} from "./types";

export const ASO_WORKSPACE_KEY = "asoWorkspace";

function recoverPlans(raw: unknown): AsoPlan[] {
  if (!Array.isArray(raw)) return [];
  const plans: AsoPlan[] = [];
  for (const item of raw) {
    const parsed = AsoPlanSchema.safeParse(item);
    if (parsed.success) plans.push(parsed.data);
  }
  return plans;
}

function parseWorkspace(raw: string | null | undefined): AsoWorkspace {
  if (!raw) return createDefaultAsoWorkspace();
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return createDefaultAsoWorkspace();
  }
  const parsed = AsoWorkspaceSchema.safeParse(obj);
  if (parsed.success) return parsed.data;

  const recoveredPlans = recoverPlans((obj as { plans?: unknown })?.plans);
  if (recoveredPlans.length) {
    console.warn("[aso] workspace schema partial recovery, plans=", recoveredPlans.length);
    const base = createDefaultAsoWorkspace();
    const partial = {
      ...base,
      ...(typeof obj === "object" && obj ? obj : {}),
      version: 1 as const,
      plans: recoveredPlans,
    };
    const retry = AsoWorkspaceSchema.safeParse(partial);
    if (retry.success) return retry.data;
  }

  console.error("[aso] workspace parse failed, resetting to default");
  return createDefaultAsoWorkspace();
}

export async function fetchProject(projectId: number) {
  return u.db("o_project").where("id", projectId).first();
}

export async function assertAsoProject(projectId: number) {
  const project = await fetchProject(projectId);
  if (!project) throw new Error("项目不存在");
  if (!isAsoProject(project.projectType)) throw new Error("该项目不是 ASO 类型");
  return project;
}

export function getDefaultWorkspace(): AsoWorkspace {
  return createDefaultAsoWorkspace();
}

async function persistWorkspace(projectId: number, workspace: AsoWorkspace) {
  const now = Date.now();
  const row = await u.db("o_agentWorkData").where({ projectId, key: ASO_WORKSPACE_KEY }).first();
  if (!row) {
    await u.db("o_agentWorkData").insert({
      id: nextEntityId(),
      projectId,
      key: ASO_WORKSPACE_KEY,
      data: JSON.stringify(workspace),
      createTime: now,
      updateTime: now,
    });
    return;
  }
  await u.db("o_agentWorkData").where({ id: row.id }).update({
    data: JSON.stringify(workspace),
    updateTime: now,
  });
}

export async function getOrCreateWorkspace(projectId: number): Promise<AsoWorkspace> {
  await assertAsoProject(projectId);
  const row = await u.db("o_agentWorkData").where({ projectId, key: ASO_WORKSPACE_KEY }).first();
  if (row?.data) return parseWorkspace(row.data);
  const workspace = getDefaultWorkspace();
  await persistWorkspace(projectId, workspace);
  return workspace;
}

export async function getWorkspace(projectId: number): Promise<AsoWorkspace> {
  await assertAsoProject(projectId);
  const row = await u.db("o_agentWorkData").where({ projectId, key: ASO_WORKSPACE_KEY }).first();
  if (!row) return getOrCreateWorkspace(projectId);
  return parseWorkspace(row.data);
}

export async function patchWorkspace(projectId: number, partial: Partial<AsoWorkspace>): Promise<AsoWorkspace> {
  await assertAsoProject(projectId);
  const current = await getOrCreateWorkspace(projectId);
  const merged = AsoWorkspaceSchema.parse({
    ...current,
    ...partial,
    version: 1 as const,
  });
  await persistWorkspace(projectId, merged);
  return merged;
}

export async function setPlans(projectId: number, plans: AsoPlan[]): Promise<AsoWorkspace> {
  return patchWorkspace(projectId, { plans });
}

export async function updatePlanById(
  projectId: number,
  planId: string,
  patch: Partial<Pick<AsoPlan, "title" | "copy" | "imagePrompts">>,
): Promise<AsoPlan> {
  const workspace = await getOrCreateWorkspace(projectId);
  const index = workspace.plans.findIndex((p) => p.id === planId);
  if (index < 0) throw new Error("方案不存在");
  const now = Date.now();
  const plan: AsoPlan = {
    ...workspace.plans[index],
    ...patch,
    edited: true,
    updatedAt: now,
  };
  const plans = [...workspace.plans];
  plans[index] = plan;
  await persistWorkspace(projectId, { ...workspace, plans });
  return plan;
}

export async function appendOutput(projectId: number, output: AsoOutputRecord): Promise<AsoWorkspace> {
  const workspace = await getOrCreateWorkspace(projectId);
  return patchWorkspace(projectId, { outputs: [...workspace.outputs, output] });
}

export async function updateOutputState(
  projectId: number,
  imageId: number,
  patch: Partial<Pick<AsoOutputRecord, "state" | "errorReason">>,
): Promise<AsoOutputRecord | undefined> {
  const workspace = await getOrCreateWorkspace(projectId);
  const index = workspace.outputs.findIndex((o) => o.imageId === imageId);
  if (index < 0) return undefined;
  const outputs = [...workspace.outputs];
  outputs[index] = { ...outputs[index], ...patch };
  await persistWorkspace(projectId, { ...workspace, outputs });
  return outputs[index];
}

export async function removeOutput(projectId: number, imageId: number): Promise<AsoWorkspace> {
  await assertAsoProject(projectId);
  const workspace = await getOrCreateWorkspace(projectId);
  const output = workspace.outputs.find((o) => o.imageId === imageId);
  if (!output) throw new Error("成品不存在");
  if (output.state === "生成中") throw new Error("生成中的成品不能删除");

  const images = await u.db("o_image").where("assetsId", output.assetId);
  await Promise.all(
    images.map((img) =>
      img.filePath
        ? u.oss.deleteFile(img.filePath).catch((e) => {
            if (e?.code !== "ENOENT") throw e;
          })
        : Promise.resolve(),
    ),
  );
  const imageIds = images.map((img) => img.id).filter(Boolean);
  if (imageIds.length) {
    await u.db("o_assets").whereIn("imageId", imageIds).update({ imageId: null });
  }
  await u.db("o_image").where("assetsId", output.assetId).delete();
  await u.db("o_assets").where({ id: output.assetId, projectId }).delete();

  const outputs = workspace.outputs.filter((o) => o.imageId !== imageId);
  return patchWorkspace(projectId, { outputs });
}

export async function syncReferencedAssets(
  projectId: number,
  assetId: number,
  action: "add" | "remove",
): Promise<AsoWorkspace> {
  const workspace = await getOrCreateWorkspace(projectId);
  let referencedAssetIds = [...workspace.referencedAssetIds];
  if (action === "add") {
    if (!referencedAssetIds.includes(assetId)) referencedAssetIds.push(assetId);
  } else {
    referencedAssetIds = referencedAssetIds.filter((id) => id !== assetId);
  }
  return patchWorkspace(projectId, { referencedAssetIds });
}

export async function isPlanOutputInProgress(projectId: number, planId: string): Promise<boolean> {
  const workspace = await getWorkspace(projectId);
  if (workspace.outputs.some((o) => o.planId === planId && o.state === "生成中")) return true;
  const imageIds = workspace.outputs.filter((o) => o.planId === planId).map((o) => o.imageId);
  if (imageIds.length === 0) return false;
  const rows = await u.db("o_image").whereIn("id", imageIds).andWhere("state", "生成中");
  return rows.length > 0;
}
