import express from "express";
import { z } from "zod";
import path from "path";
import fs from "fs/promises";
import u from "@/utils";
import { success, apiError } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assertUiuxProject } from "@/services/aso/workspace";
import { acquireUiuxInputOp, httpStatusFromError, releaseUiuxInputOp } from "@/services/aso/generationLock";

const router = express.Router();

async function loadOptimizerPrompt(): Promise<string> {
  const skillPath = path.join(u.getPath(), "skills", "uiux_prompt_optimizer.md");
  const raw = await fs.readFile(skillPath, "utf-8");
  // Match planGenerator frontmatter strip (keep CRLF-safe)
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    inputText: z.string().min(1),
  }),
  async (req, res) => {
    let done: ((state: 1 | -1, reason?: string) => Promise<void>) | undefined;
    try {
      const { projectId, inputText } = req.body;
      await assertUiuxProject(projectId);
      acquireUiuxInputOp(projectId);

      done = await u.task(projectId, "UIUX提示词优化", "universalAi", {
        describe: "优化 UI/UX 设计需求描述",
        content: { inputLength: inputText.length },
      });

      const systemPrompt = await loadOptimizerPrompt();
      const { text } = await u.Ai.Text("universalAi").invoke({
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `请优化以下 UI/UX 设计需求描述：\n\n${inputText}`,
          },
        ],
      });

      await done(1);
      res.status(200).send(success({ optimizedText: text }));
    } catch (e) {
      const message = u.error(e).message;
      await done?.(-1, message).catch(() => undefined);
      const status = e instanceof Error && e.message.includes("不存在") ? 404 : httpStatusFromError(e);
      res.status(status).send(apiError(message, status));
    } finally {
      const projectId = req.body?.projectId;
      if (typeof projectId === "number") releaseUiuxInputOp(projectId);
    }
  },
);
