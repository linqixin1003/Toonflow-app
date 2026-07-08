import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assertAsoProject } from "@/services/aso/workspace";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    type: z.enum(["aso_material", "aso_output"]).optional(),
  }),
  async (req, res) => {
    const { projectId, type = "aso_material" } = req.body;
    await assertAsoProject(projectId);

    const rows = await u
      .db("o_assets")
      .leftJoin("o_image", "o_assets.imageId", "o_image.id")
      .where("o_assets.projectId", projectId)
      .where("o_assets.type", type)
      .select(
        "o_assets.id",
        "o_assets.name",
        "o_assets.type",
        "o_assets.describe",
        "o_assets.remark",
        "o_image.id as imageId",
        "o_image.filePath",
        "o_image.state",
      );

    const data = await Promise.all(
      rows.map(async (row: any) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        materialKind: row.filePath ? "image" : "text",
        describe: row.describe,
        imageId: row.imageId,
        filePath: row.filePath ? await u.oss.getSmallImageUrl(row.filePath) : null,
        state: row.state,
      })),
    );

    res.status(200).send(success(data));
  },
);
