let seq = 0;

/** Monotonic-ish numeric IDs safe for concurrent inserts within one process. */
export function nextEntityId(): number {
  seq = (seq + 1) % 1000;
  return Date.now() * 1000 + seq;
}

export function nextEntityIds(count: number): number[] {
  return Array.from({ length: count }, () => nextEntityId());
}
