import type { AsoSizePreset, AsoPlatform } from "./asoSizePresets";

type UiuxPresetCategory = "device";

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

function toSizeTier(width: number, height: number): "1K" | "2K" | "4K" {
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
  extra?: { default?: boolean },
): AsoSizePreset {
  return {
    id,
    label,
    width,
    height,
    platform,
    category: "device" as unknown as AsoSizePreset["category"],
    aspectRatio: toAspectRatio(width, height),
    sizeTier: toSizeTier(width, height),
    ...extra,
  };
}

export const UIUX_SIZE_PRESETS: readonly AsoSizePreset[] = [
  preset("iphone_14_390x844", "iPhone 14/15", 390, 844, "ios", { default: true }),
  preset("iphone_14plus_428x926", "iPhone 14 Plus/15 Plus", 428, 926, "ios"),
  preset("iphone_se_375x667", "iPhone SE", 375, 667, "ios"),
  preset("ipad_mini_744x1133", "iPad Mini", 744, 1133, "ios"),
  preset("android_compact_360x800", "Android Compact", 360, 800, "android"),
  preset("android_medium_412x915", "Android Medium", 412, 915, "android"),
  preset("android_expanded_840x915", "Android Expanded", 840, 915, "android"),
] as const;

const UIUX_PRESET_BY_ID = new Map(UIUX_SIZE_PRESETS.map((p) => [p.id, p]));

export function getUiuxPresetById(id: string): AsoSizePreset | undefined {
  return UIUX_PRESET_BY_ID.get(id);
}

export function getDefaultUiuxPreset(): AsoSizePreset {
  return UIUX_SIZE_PRESETS.find((p) => p.default) ?? UIUX_SIZE_PRESETS[0];
}

export function listUiuxPresetsGrouped(): Record<"ios" | "android", string[]> {
  return {
    ios: UIUX_SIZE_PRESETS.filter((p) => p.platform === "ios").map((p) => p.id),
    android: UIUX_SIZE_PRESETS.filter((p) => p.platform === "android").map((p) => p.id),
  };
}

export function listAllUiuxPresets(): AsoSizePreset[] {
  return [...UIUX_SIZE_PRESETS];
}
