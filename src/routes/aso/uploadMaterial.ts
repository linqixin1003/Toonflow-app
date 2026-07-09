import express from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assertAsoProject, syncReferencedAssets } from "@/services/aso/workspace";
import { nextEntityId } from "@/services/aso/id";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    name: z.string().optional(),
    base64: z.string(),
    describe: z.string().optional(),
  }),
  async (req, res) => {
    try {
      const { projectId, name, base64, describe } = req.body;
      await assertAsoProject(projectId);

      const matches = base64.match(/^data:image\/\w+;base64,(.+)$/);
      const realBase64 = matches ? matches[1] : base64;
      const buffer = Buffer.from(realBase64, "base64");
      if (buffer.length > MAX_UPLOAD_BYTES) {
        return res.status(400).send(error(`图片过大，最大 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB`));
      }
      const savePath = `/${projectId}/aso/material/${uuidv4()}.png`;
      await u.oss.writeFile(savePath, buffer);

      const assetId = nextEntityId();
      const [imageId] = await u.db("o_image").insert({
        assetsId: assetId,
        filePath: savePath,
        type: "aso_material",
        state: "已完成",
      });

      await u.db("o_assets").insert({
        id: assetId,
        projectId,
        type: "aso_material",
        name: name || "素材",
        describe: describe || "",
        remark: "image",
        imageId,
      });

      await syncReferencedAssets(projectId, assetId, "add");

      res.status(200).send(
        success({
          assetId,
          imageId,
          materialKind: "image",
          filePath: await u.oss.getSmallImageUrl(savePath),
        }),
      );
    } catch (e) {
      res.status(400).send(error(u.error(e).message));
    }
  },
);
