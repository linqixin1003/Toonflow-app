import { z } from "zod";

export const AsoPlanSchema = z.object({
  id: z.string(),
  title: z.string(),
  copy: z.string(),
  edited: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const AsoLastPlanGenerationSchema = z.object({
  status: z.enum(["idle", "generating", "done", "error"]),
  errorReason: z.string().optional(),
  updatedAt: z.number(),
});

export const AsoOutputRecordSchema = z.object({
  planId: z.string(),
  assetId: z.number(),
  imageId: z.number(),
  presetId: z.string(),
  width: z.number(),
  height: z.number(),
  state: z.enum(["生成中", "已完成", "生成失败"]),
  errorReason: z.string().optional(),
  createdAt: z.number(),
});

export const AsoWorkspaceSchema = z.object({
  version: z.literal(1),
  inputText: z.string(),
  planCount: z.number().int().min(1).max(10),
  plans: z.array(AsoPlanSchema),
  selectedPlanId: z.string().nullable(),
  referencedAssetIds: z.array(z.number()),
  outputSizePreset: z.string(),
  outputs: z.array(AsoOutputRecordSchema),
  lastPlanGeneration: AsoLastPlanGenerationSchema.optional(),
});

export type AsoPlan = z.infer<typeof AsoPlanSchema>;
export type AsoOutputRecord = z.infer<typeof AsoOutputRecordSchema>;
export type AsoWorkspace = z.infer<typeof AsoWorkspaceSchema>;
export type AsoLastPlanGeneration = z.infer<typeof AsoLastPlanGenerationSchema>;

export const AsoMaterialKindSchema = z.enum(["image", "text"]);

export function createDefaultAsoWorkspace(): AsoWorkspace {
  return {
    version: 1,
    inputText: "",
    planCount: 3,
    plans: [],
    selectedPlanId: null,
    referencedAssetIds: [],
    outputSizePreset: "general_vertical_1080x1920",
    outputs: [],
    lastPlanGeneration: { status: "idle", updatedAt: 0 },
  };
}
