import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assertUiuxProject } from "@/services/aso/workspace";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    imageIds: z.array(z.number()),
  }),
  async (req, res) => {
    const { projectId, imageIds } = req.body;
    await assertUiuxProject(projectId);

    const rows = await u
      .db("o_image")
      .leftJoin("o_assets", "o_image.assetsId", "o_assets.id")
      .whereIn("o_image.id", imageIds)
      .where("o_assets.projectId", projectId)
      .select(
        "o_image.id as imageId",
        "o_image.state",
        "o_image.filePath",
        "o_image.errorReason",
        "o_image.resolution",
        "o_assets.id as assetId",
      );

    const data = await Promise.all(
      rows.map(async (row: any) => {
        const [w, h] = (row.resolution || "0x0").split("x").map(Number);
        return {
          imageId: row.imageId,
          assetId: row.assetId,
          state: row.state,
          filePath: row.filePath ? await u.oss.getSmallImageUrl(row.filePath) : null,
          originalFilePath: row.filePath ? await u.oss.getFileUrl(row.filePath) : null,
          errorReason: row.errorReason,
          width: w || undefined,
          height: h || undefined,
        };
      }),
    );

    res.status(200).send(success(data));
  },
);
