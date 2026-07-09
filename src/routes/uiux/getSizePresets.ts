import express from "express";
import { success } from "@/lib/responseFormat";
import { UIUX_SIZE_PRESETS, listUiuxPresetsGrouped } from "@/constants/uiuxSizePresets";

const router = express.Router();

export default router.get("/", async (_req, res) => {
  res.status(200).send(
    success({
      presets: UIUX_SIZE_PRESETS,
      grouped: listUiuxPresetsGrouped(),
    }),
  );
});
