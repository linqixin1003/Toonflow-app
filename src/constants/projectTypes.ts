export type ProjectTypeValue = "novel" | "script" | "aso" | "uiux";

export interface ProjectTypeConfig {
  value: ProjectTypeValue;
  labelKey: string;
  modules: readonly string[];
}

export const PROJECT_TYPES = {
  novel: {
    value: "novel",
    labelKey: "workbench.project.dialog.basedOnNovel",
    modules: ["novel", "scriptAgent", "production"],
  },
  script: {
    value: "script",
    labelKey: "workbench.project.dialog.basedOnScript",
    modules: ["script", "scriptAgent", "production"],
  },
  aso: {
    value: "aso",
    labelKey: "workbench.project.dialog.basedOnAso",
    modules: ["aso"],
  },
  uiux: {
    value: "uiux",
    labelKey: "workbench.project.dialog.basedOnUiux",
    modules: ["uiux"],
  },
} as const satisfies Record<ProjectTypeValue, ProjectTypeConfig>;

export const PROJECT_TYPE_VALUES = Object.values(PROJECT_TYPES).map((t) => t.value);

export function isAsoProject(projectType: string | null | undefined): boolean {
  return projectType === "aso";
}

export function isKnownProjectType(projectType: string | null | undefined): projectType is ProjectTypeValue {
  return projectType === "novel" || projectType === "script" || projectType === "aso" || projectType === "uiux";
}

export function isUiuxProject(projectType: string | null | undefined): boolean {
  return projectType === "uiux";
}

export function isCreativeProject(projectType: string | null | undefined): boolean {
  return projectType === "aso" || projectType === "uiux";
}

export function getProjectTypeConfig(projectType: string | null | undefined): ProjectTypeConfig | undefined {
  if (!isKnownProjectType(projectType)) return undefined;
  return PROJECT_TYPES[projectType];
}
