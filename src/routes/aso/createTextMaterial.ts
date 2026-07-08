import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assertAsoProject, syncReferencedAssets } from "@/services/aso/workspace";
import { nextEntityId } from "@/services/aso/id";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    name: z.string(),
    describe: z.string(),
  }),
  async (req, res) => {
    try {
      const { projectId, name, describe } = req.body;
      await assertAsoProject(projectId);
      if (!describe.trim()) return res.status(400).send(error("文字描述不能为空"));

      const assetId = nextEntityId();
      await u.db("o_assets").insert({
        id: assetId,
        projectId,
        type: "aso_material",
        name,
        describe,
        remark: "text",
        imageId: null,
      });

      await syncReferencedAssets(projectId, assetId, "add");

      res.status(200).send(
        success({
          assetId,
          materialKind: "text",
          name,
          describe,
        }),
      );
    } catch (e) {
      res.status(400).send(error(u.error(e).message));
    }
  },
);
