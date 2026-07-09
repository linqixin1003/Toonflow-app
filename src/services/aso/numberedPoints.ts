/** Extract numbered / bulleted selling points from free-form brief text. */
export function extractNumberedPoints(inputText: string): string[] {
  const text = inputText?.trim() || "";
  if (!text) return [];
  const points: string[] = [];
  const lineRe = /^\s*(?:(\d{1,2})[.)、．]|[-*•]|[（(](\d{1,2})[）)])\s*(.+?\S)\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = lineRe.exec(text)) !== null) {
    const body = (match[3] || "").trim();
    if (body.length >= 2) points.push(body);
  }
  if (points.length >= 2) return points;
  return [];
}

/** Resolve how many image prompts each plan should contain (0 = legacy title+copy only). */
export function resolveImagePromptCount(inputText: string, explicit?: number | null): number {
  if (explicit != null && Number.isFinite(explicit)) {
    const n = Math.floor(explicit);
    if (n === 0) return 0;
    if (n >= 1) return Math.min(Math.max(n, 1), 20);
  }
  const points = extractNumberedPoints(inputText);
  if (points.length >= 1) return Math.min(points.length, 20);
  return 0;
}

export function slotLabelsForImagePrompts(inputText: string, imagePromptCount: number): string[] {
  const points = extractNumberedPoints(inputText);
  const labels: string[] = [];
  for (let i = 0; i < imagePromptCount; i++) {
    labels.push(points[i] || `图${i + 1}`);
  }
  return labels;
}
