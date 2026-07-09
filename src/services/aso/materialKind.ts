export function isTextMaterialRemark(remark?: string | null): boolean {
  const r = String(remark || "");
  return r === "text" || /^text:\d+$/.test(r);
}

export function parseTextMaterialSlot(remark?: string | null): number | undefined {
  const m = String(remark || "").match(/^text:(\d+)$/);
  if (!m) return undefined;
  const slot = Number(m[1]);
  return Number.isFinite(slot) && slot >= 1 ? slot : undefined;
}

export function formatTextMaterialRemark(promptSlot?: number): string {
  if (promptSlot != null && promptSlot >= 1) return `text:${promptSlot}`;
  return "text";
}

export function resolveMaterialKind(row: {
  remark?: string | null;
  imageId?: number | null;
  filePath?: string | null;
}): "image" | "text" {
  if (isTextMaterialRemark(row.remark)) return "text";
  if (row.imageId != null) return "image";
  if (row.filePath) return "image";
  if (row.remark === "image" || String(row.remark || "").startsWith("variant:")) return "image";
  return "text";
}
