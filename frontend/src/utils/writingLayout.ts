export const WRITING_LAYOUT_KEY = "inkmind_write_layout";
export const CHAPTER_WIDTH = { min: 180, max: 320, initial: 228 };
export const TOOLS_WIDTH = { min: 280, max: 520, initial: 380 };
export const WRITING_GAP = 12;
export const MIN_EDITOR_WIDTH = 600;

export interface WritingLayoutPreference {
  chaptersOpen: boolean;
  chapterWidth: number;
  toolsWidth: number;
}

export function clampWidth(value: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(value, min), Math.max(min, max)));
}

export function readWritingLayout(storage: Pick<Storage, "getItem">): WritingLayoutPreference {
  const fallback = { chaptersOpen: true, chapterWidth: CHAPTER_WIDTH.initial, toolsWidth: TOOLS_WIDTH.initial };
  try {
    const value = JSON.parse(storage.getItem(WRITING_LAYOUT_KEY) || "null");
    if (!value || typeof value !== "object") return fallback;
    return {
      chaptersOpen: typeof value.chaptersOpen === "boolean" ? value.chaptersOpen : true,
      chapterWidth: typeof value.chapterWidth === "number" && Number.isFinite(value.chapterWidth)
        ? clampWidth(value.chapterWidth, CHAPTER_WIDTH.min, CHAPTER_WIDTH.max) : fallback.chapterWidth,
      toolsWidth: typeof value.toolsWidth === "number" && Number.isFinite(value.toolsWidth)
        ? clampWidth(value.toolsWidth, TOOLS_WIDTH.min, TOOLS_WIDTH.max) : fallback.toolsWidth,
    };
  } catch { return fallback; }
}

/** Clamp the rendered width only: narrowing the window must not overwrite a saved preference. */
export function calculateWritingLayout(width: number, panelOpen: boolean, preference: WritingLayoutPreference) {
  const toolsMax = Math.max(TOOLS_WIDTH.min, Math.min(TOOLS_WIDTH.max, width - MIN_EDITOR_WIDTH - WRITING_GAP));
  const toolsWidth = clampWidth(preference.toolsWidth, TOOLS_WIDTH.min, toolsMax);
  const available = width - (panelOpen ? toolsWidth + WRITING_GAP : 0);
  const chapterMax = Math.max(CHAPTER_WIDTH.min, Math.min(CHAPTER_WIDTH.max, available - MIN_EDITOR_WIDTH - WRITING_GAP));
  const chapterWidth = clampWidth(preference.chapterWidth, CHAPTER_WIDTH.min, CHAPTER_WIDTH.max);
  const autoCollapsed = preference.chaptersOpen && available - chapterWidth - WRITING_GAP < MIN_EDITOR_WIDTH;
  return { toolsWidth, toolsMax, chapterWidth, chapterMax, autoCollapsed };
}
