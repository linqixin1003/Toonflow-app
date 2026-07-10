import { assertAsoProject } from "@/services/aso/workspace";
import { createGenerateImageRouter } from "@/services/aso/creativeRouteFactory";

export default createGenerateImageRouter({
  assertProject: assertAsoProject,
  projectType: "aso",
  logLabel: "ASO图生成",
});
