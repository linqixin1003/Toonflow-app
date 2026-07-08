import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assertAsoProject, syncReferencedAssets } from "@/services/aso/workspace";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    assetId: z.number(),
  }),
  async (req, res) => {
    try {
      const { projectId, assetId } = req.body;
      await assertAsoProject(projectId);

      const asset = await u.db("o_assets").where({ id: assetId, projectId }).first();
      if (!asset) return res.status(404).send(error("素材不存在"));

      const images = await u.db("o_image").where("assetsId", assetId);
      await Promise.all(
        images.map((img) =>
          img.filePath
            ? u.oss.deleteFile(img.filePath).catch((e) => {
                if (e?.code !== "ENOENT") throw e;
              })
            : Promise.resolve(),
        ),
      );
      await u.db("o_image").where("assetsId", assetId).delete();
      await u.db("o_assets").where("id", assetId).delete();
      await syncReferencedAssets(projectId, assetId, "remove");

      res.status(200).send(success({ message: "删除成功" }));
    } catch (e) {
      res.status(400).send(error(u.error(e).message));
    }
  },
);
