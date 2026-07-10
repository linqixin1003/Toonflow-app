import { assertUiuxProject } from "@/services/aso/workspace";
import { createGenerateImageRouter } from "@/services/aso/creativeRouteFactory";

export default createGenerateImageRouter({
  assertProject: assertUiuxProject,
  projectType: "uiux",
  logLabel: "UIUX图生成",
});
