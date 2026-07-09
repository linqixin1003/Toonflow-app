import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assertUiuxProject, syncReferencedAssets } from "@/services/aso/workspace";
import { nextEntityId } from "@/services/aso/id";
import { formatTextMaterialRemark } from "@/services/aso/materialKind";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    name: z.string().optional(),
    describe: z.string(),
    promptSlot: z.number().int().min(1).max(20),
  }),
  async (req, res) => {
    try {
      const { projectId, describe, promptSlot } = req.body;
      const name = (req.body.name as string | undefined)?.trim() || `第${promptSlot}张补仓`;
      await assertUiuxProject(projectId);
      if (!describe.trim()) return res.status(400).send(error("文字描述不能为空"));

      const assetId = nextEntityId();
      await u.db("o_assets").insert({
        id: assetId,
        projectId,
        type: "aso_material",
        name,
        describe,
        remark: formatTextMaterialRemark(promptSlot),
        imageId: null,
      });

      await syncReferencedAssets(projectId, assetId, "add");

      res.status(200).send(
        success({
          assetId,
          materialKind: "text",
          name,
          describe,
          promptSlot,
        }),
      );
    } catch (e) {
      res.status(400).send(error(u.error(e).message));
    }
  },
);
