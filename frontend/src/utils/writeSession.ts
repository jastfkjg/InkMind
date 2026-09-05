export type EditorSnapshot = { title: string; summary: string; content: string };
export type WritingPosition = { chapterId: number; start: number; end: number; scrollTop: number };
export type WritingDraft = EditorSnapshot & { chapterId: number; savedAt: number };

export function sameSnapshot(a: EditorSnapshot, b: EditorSnapshot): boolean {
  return a.title === b.title && a.summary === b.summary && a.content === b.content;
}

export function sessionKey(userId: number, novelId: number): string {
  return `inkmind_write_session:${userId}:${novelId}`;
}

export function draftKey(userId: number, novelId: number, chapterId: number): string {
  return `inkmind_write_draft:${userId}:${novelId}:${chapterId}`;
}

export function readPosition(storage: Storage, key: string): WritingPosition | null {
  try {
    const p = JSON.parse(storage.getItem(key) || "null");
    if (p && Number.isInteger(p.chapterId) && p.chapterId > 0 &&
      [p.start, p.end, p.scrollTop].every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0)) {
      return p;
    }
  } catch { /* Storage may be unavailable or contain an older format. */ }
  return null;
}

export function readDraft(storage: Storage, key: string): WritingDraft | null {
  try {
    const d = JSON.parse(storage.getItem(key) || "null");
    if (d && Number.isInteger(d.chapterId) && typeof d.savedAt === "number" &&
      [d.title, d.summary, d.content].every((v) => typeof v === "string")) return d;
  } catch { /* A draft must never prevent opening a chapter. */ }
  return null;
}

/** Join concurrent saves; callers all await the complete drain of the latest editor state. */
export function singleFlight(work: () => Promise<void>): () => Promise<void> {
  let pending: Promise<void> | null = null;
  return () => {
    if (!pending) pending = work().finally(() => { pending = null; });
    return pending;
  };
}
