export type ReviewSegment = { before: string; after: string; changed: boolean };
const paragraphs = (text: string): string[] => text.match(/[^\n]+(?:\n+|$)|\n+/g) ?? [];

/** Preserve every character. Anchor unchanged paragraphs, then pair changed ones.
 * Bound the LCS table so unusually long manuscripts cannot stall the editor. */
export function reviewSegments(original: string, proposal: string): ReviewSegment[] {
  const before = paragraphs(original);
  const after = paragraphs(proposal);
  const result: ReviewSegment[] = [];
  const pair = (left: string[], right: string[]) => {
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      const a = left[i] ?? "", b = right[i] ?? "";
      result.push({ before: a, after: b, changed: a !== b });
    }
  };
  if (before.length * after.length > 250_000) { pair(before, after); return result; }
  const table = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1));
  for (let i = before.length - 1; i >= 0; i--) for (let j = after.length - 1; j >= 0; j--) {
    table[i][j] = before[i] === after[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  let i = 0, j = 0, left: string[] = [], right: string[] = [];
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      pair(left, right); left = []; right = [];
      result.push({ before: before[i], after: after[j], changed: false }); i++; j++;
    } else if (i < before.length && (j === after.length || table[i + 1][j] >= table[i][j + 1])) {
      left.push(before[i++]);
    } else { right.push(after[j++]); }
  }
  pair(left, right);
  return result;
}

export function reviewedContent(segments: ReviewSegment[], rejected: ReadonlySet<number>): string {
  return segments.map((segment, index) => rejected.has(index) ? segment.before : segment.after).join("");
}
