export type AsoPlatform = "ios" | "android" | "general";
export type AsoPresetCategory = "preview" | "screenshot" | "icon" | "feature" | "promo";
export type AsoSizeTier = "1K" | "2K" | "4K";

export interface AsoSizePreset {
  id: string;
  label: string;
  width: number;
  height: number;
  platform: AsoPlatform;
  category: AsoPresetCategory;
  aspectRatio: `${number}:${number}`;
  sizeTier: AsoSizeTier;
  default?: boolean;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function toAspectRatio(width: number, height: number): `${number}:${number}` {
  const d = gcd(width, height);
  return `${width / d}:${height / d}`;
}

function toSizeTier(width: number, height: number): AsoSizeTier {
  const maxEdge = Math.max(width, height);
  if (maxEdge <= 1080) return "1K";
  if (maxEdge <= 2048) return "2K";
  return "4K";
}

function preset(
  id: string,
  label: string,
  width: number,
  height: number,
  platform: AsoPlatform,
  category: AsoPresetCategory,
  extra?: { default?: boolean },
): AsoSizePreset {
  return {
    id,
    label,
    width,
    height,
    platform,
    category,
    aspectRatio: toAspectRatio(width, height),
    sizeTier: toSizeTier(width, height),
    ...extra,
  };
}

export const ASO_SIZE_PRESETS: readonly AsoSizePreset[] = [
  preset("ios_preview_9_16", "App 预览 9:16", 1080, 1920, "ios", "preview"),
  preset("ios_preview_16_9", "App 预览 16:9", 1920, 1080, "ios", "preview"),
  preset("ios_screenshot_67", 'iPhone 6.7" 截图', 1290, 2796, "ios", "screenshot"),
  preset("ios_screenshot_65", 'iPhone 6.5" 截图', 1242, 2688, "ios", "screenshot"),
  preset("ios_screenshot_55", 'iPhone 5.5" 截图', 1242, 2208, "ios", "screenshot"),
  preset("ios_screenshot_ipad_129", 'iPad 12.9" 截图', 2048, 2732, "ios", "screenshot"),
  preset("android_feature_graphic", "Feature Graphic", 1024, 500, "android", "feature"),
  preset("android_icon", "App Icon", 512, 512, "android", "icon"),
  preset("android_screenshot_9_16", "截图 9:16", 1080, 1920, "android", "screenshot"),
  preset("general_vertical_1080x1920", "竖版主图", 1080, 1920, "general", "promo", { default: true }),
  preset("general_square_1080", "方图", 1080, 1080, "general", "promo"),
  preset("general_horizontal_1920x1080", "横版", 1920, 1080, "general", "promo"),
] as const;

const PRESET_BY_ID = new Map(ASO_SIZE_PRESETS.map((p) => [p.id, p]));

export function getPresetById(id: string): AsoSizePreset | undefined {
  return PRESET_BY_ID.get(id);
}

export function getDefaultPreset(): AsoSizePreset {
  return ASO_SIZE_PRESETS.find((p) => p.default) ?? ASO_SIZE_PRESETS[9];
}

export function listPresetsGrouped(): Record<AsoPlatform, string[]> {
  return {
    ios: ASO_SIZE_PRESETS.filter((p) => p.platform === "ios").map((p) => p.id),
    android: ASO_SIZE_PRESETS.filter((p) => p.platform === "android").map((p) => p.id),
    general: ASO_SIZE_PRESETS.filter((p) => p.platform === "general").map((p) => p.id),
  };
}

export function listAllPresets(): AsoSizePreset[] {
  return [...ASO_SIZE_PRESETS];
}
