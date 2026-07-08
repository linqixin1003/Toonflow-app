import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assertAsoProject, getOrCreateWorkspace } from "@/services/aso/workspace";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
  }),
  async (req, res) => {
    try {
      const { projectId } = req.body;
      await assertAsoProject(projectId);
      const workspace = await getOrCreateWorkspace(projectId);
      const assetRows = await u
        .db("o_assets")
        .leftJoin("o_image", "o_assets.imageId", "o_image.id")
        .where("o_assets.projectId", projectId)
        .where("o_assets.type", "aso_material")
        .select("o_assets.id", "o_assets.name", "o_assets.describe", "o_assets.remark", "o_image.id as imageId", "o_image.filePath", "o_image.state");

      const materials = await Promise.all(
        assetRows.map(async (row: any) => {
          const materialKind = row.filePath ? "image" : "text";
          return {
            id: row.id,
            name: row.name,
            type: "aso_material",
            materialKind,
            describe: row.describe,
            imageId: row.imageId,
            filePath: row.filePath ? await u.oss.getSmallImageUrl(row.filePath) : null,
            state: row.state,
          };
        }),
      );

      res.status(200).send(success({ workspace, materials }));
    } catch (e) {
      res.status(400).send(error(u.error(e).message));
    }
  },
);
