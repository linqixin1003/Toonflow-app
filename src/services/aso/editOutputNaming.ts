import type { AsoOutputRecord } from "./types";

function parseEditTag(tag?: string): number {
  const m = tag?.match(/^e(\d+)$/);
  return m ? Number(m[1]) : 0;
}

export function resolveNextEditTag(outputs: AsoOutputRecord[], planId: string, promptSlot?: number): string {
  if (promptSlot == null) {
    const count = outputs.filter((o) => o.planId === planId && o.sourceImageId != null).length;
    return `e${count + 1}`;
  }
  const siblings = outputs.filter((o) => o.planId === planId && o.promptSlot === promptSlot && o.editTag);
  const maxN = siblings.reduce((max, o) => Math.max(max, parseEditTag(o.editTag)), 0);
  return `e${maxN + 1}`;
}

export function parseEditTagIndex(tag?: string): number {
  return parseEditTag(tag);
}
