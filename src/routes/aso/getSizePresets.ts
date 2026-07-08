import express from "express";
import { success } from "@/lib/responseFormat";
import { ASO_SIZE_PRESETS, listPresetsGrouped } from "@/constants/asoSizePresets";

const router = express.Router();

export default router.get("/", async (_req, res) => {
  res.status(200).send(
    success({
      presets: ASO_SIZE_PRESETS,
      grouped: listPresetsGrouped(),
    }),
  );
});
