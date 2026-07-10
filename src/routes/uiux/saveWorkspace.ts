import { assertUiuxProject } from "@/services/aso/workspace";
import { createSaveWorkspaceRouter } from "@/services/aso/creativeRouteFactory";

export default createSaveWorkspaceRouter(assertUiuxProject);
