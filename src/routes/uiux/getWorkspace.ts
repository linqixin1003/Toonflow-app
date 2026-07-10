import { assertUiuxProject } from "@/services/aso/workspace";
import { createGetWorkspaceRouter } from "@/services/aso/creativeRouteFactory";

export default createGetWorkspaceRouter(assertUiuxProject);
