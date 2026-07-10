import { assertAsoProject } from "@/services/aso/workspace";
import { createSaveWorkspaceRouter } from "@/services/aso/creativeRouteFactory";

export default createSaveWorkspaceRouter(assertAsoProject);
