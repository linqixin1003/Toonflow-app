import express from "express";
import { z } from "zod";
import path from "path";
import fs from "fs/promises";
import u from "@/utils";
import { success, apiError } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assertUiuxProject } from "@/services/aso/workspace";
import { loadMaterials, resolvePlanModel, buildPlanMessages } from "@/services/aso/planGenerator";

const router = express.Router();

async function loadRefinerPrompt(): Promise<string> {
  const skillPath = path.join(u.getPath(), "skills", "uiux_raw_input_analyzer.md");
  const raw = await fs.readFile(skillPath, "utf-8");
  return raw.replace(/^---[\s\S]*?---\s*/, "").trim();
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    rawInput: z.string().min(1),
    assetIds: z.array(z.number()).optional(),
  }),
  async (req, res) => {
    try {
      const { projectId, rawInput, assetIds = [] } = req.body;
      await assertUiuxProject(projectId);

      const systemPrompt = await loadRefinerPrompt();
      const materials = await loadMaterials(projectId, assetIds);
      const modelKey = await resolvePlanModel(materials);

      const userPrompt = `请整理以下原始需求为专业的 UI/UX 创意输入文档：\n\n${rawInput}`;
      const messages = await buildPlanMessages(systemPrompt, userPrompt, materials, modelKey);

      const { text } = await u.Ai.Text(modelKey).invoke({
        messages: messages as any,
        maxOutputTokens: 2048,
      });

      // Record task
      await u.task(projectId, "UIUX原始需求整理", modelKey, {
        describe: "整理原始需求为创意输入",
        content: { inputLength: rawInput.length, assetCount: assetIds.length },
      });

      res.status(200).send(success({ refinedText: text }));
    } catch (e) {
      const status = e instanceof Error && e.message.includes("不存在") ? 404 : 400;
      res.status(status).send(apiError(u.error(e).message, status));
    }
  },
);
