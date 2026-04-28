export type AiTool = "generate" | "rewrite" | "append" | "naming" | "ask" | "evaluate" | "versions";

export type GenerateTab = "single" | "batch";

export type GenerateMode = "foreground" | "background";

export type NamingCategory = "character" | "item" | "skill" | "other";

export type SelectionMode = "expand" | "polish";

export type LineHeightId = "compact" | "normal" | "relaxed" | "loose";

export type LineWidthId = "md" | "lg" | "full";

export type WriteBodyFontSizeId = "xs" | "sm" | "md" | "lg" | "xl" | "xxl";

export const RAIL_ITEM_KEYS: { key: AiTool; labelKey: string }[] = [
  { key: "generate", labelKey: "write_tool_generate" },
  { key: "rewrite", labelKey: "write_tool_rewrite" },
  { key: "append", labelKey: "write_tool_append" },
  { key: "naming", labelKey: "write_tool_naming" },
  { key: "ask", labelKey: "write_tool_ask" },
  { key: "evaluate", labelKey: "write_tool_evaluate" },
  { key: "versions", labelKey: "write_tool_versions" },
];

export const LINE_HEIGHT_IDS: LineHeightId[] = ["compact", "normal", "relaxed", "loose"];

export const LINE_HEIGHT_VALUES: Record<LineHeightId, number> = {
  compact: 1.6,
  normal: 1.85,
  relaxed: 2.0,
  loose: 2.2,
};

export const LINE_HEIGHT_LABEL_KEYS: Record<LineHeightId, string> = {
  compact: "write_line_height_compact",
  normal: "write_line_height_normal",
  relaxed: "write_line_height_relaxed",
  loose: "write_line_height_loose",
};

export const WRITE_LINE_HEIGHT_KEY = "inkmind_write_line_height";

export const LINE_WIDTH_IDS: LineWidthId[] = ["md", "lg", "full"];

export const LINE_WIDTH_MAX_WIDTHS: Record<LineWidthId, string | null> = {
  md: "55ch",
  lg: "68ch",
  full: null,
};

export const LINE_WIDTH_LABEL_KEYS: Record<LineWidthId, string> = {
  md: "write_line_width_md",
  lg: "write_line_width_lg",
  full: "write_line_width_full",
};

export const WRITE_LINE_WIDTH_KEY = "inkmind_write_line_width";

export const WRITE_FOCUS_MODE_KEY = "inkmind_write_focus_mode";

export const LEGACY_LINE_WIDTH_MAP: Record<string, LineWidthId> = {
  narrow: "md",
  medium: "md",
  wide: "lg",
  full: "full",
  xs: "md",
  sm: "md",
  lg: "lg",
  xl: "lg",
  "2xl": "lg",
};

export const WRITE_BODY_FONT_SIZE_IDS: WriteBodyFontSizeId[] = ["xs", "sm", "md", "lg", "xl", "xxl"];

export const WRITE_BODY_FONT_SIZE_PX: Record<WriteBodyFontSizeId, number> = {
  xs: 14,
  sm: 16,
  md: 17,
  lg: 19,
  xl: 21,
  xxl: 24,
};

export const WRITE_BODY_FONT_SIZE_LABEL_KEYS: Record<WriteBodyFontSizeId, string> = {
  xs: "write_font_size_xs",
  sm: "write_font_size_sm",
  md: "write_font_size_md",
  lg: "write_font_size_lg",
  xl: "write_font_size_xl",
  xxl: "write_font_size_xxl",
};

export const WRITE_BODY_FONT_SIZE_KEY = "inkmind_write_body_font_size";

export const LEGACY_BODY_FONT_SIZE_PX_KEY = "inkmind_write_body_font_size_px";

export function readStoredLineHeight(): LineHeightId {
  try {
    const v = localStorage.getItem(WRITE_LINE_HEIGHT_KEY);
    if (v && LINE_HEIGHT_IDS.includes(v as LineHeightId)) {
      return v as LineHeightId;
    }
  } catch {
    /* ignore */
  }
  return "normal";
}

export function readStoredLineWidth(): LineWidthId {
  try {
    const v = localStorage.getItem(WRITE_LINE_WIDTH_KEY);
    if (v) {
      if (LINE_WIDTH_IDS.includes(v as LineWidthId)) {
        return v as LineWidthId;
      }
      const mapped = LEGACY_LINE_WIDTH_MAP[v];
      if (mapped) {
        localStorage.setItem(WRITE_LINE_WIDTH_KEY, mapped);
        return mapped;
      }
    }
  } catch {
    /* ignore */
  }
  return "full";
}

export function readStoredFocusMode(): boolean {
  try {
    const v = localStorage.getItem(WRITE_FOCUS_MODE_KEY);
    return v === "true";
  } catch {
    return false;
  }
}

export function nearestFontSizeId(px: number): WriteBodyFontSizeId {
  let best = WRITE_BODY_FONT_SIZE_IDS[0];
  let d = Math.abs(px - WRITE_BODY_FONT_SIZE_PX[best]);
  for (const id of WRITE_BODY_FONT_SIZE_IDS) {
    const dd = Math.abs(px - WRITE_BODY_FONT_SIZE_PX[id]);
    if (dd < d) {
      d = dd;
      best = id;
    }
  }
  return best;
}

export function readStoredBodyFontSizeId(): WriteBodyFontSizeId {
  try {
    const v = localStorage.getItem(WRITE_BODY_FONT_SIZE_KEY);
    if (v && WRITE_BODY_FONT_SIZE_IDS.includes(v as WriteBodyFontSizeId)) {
      return v as WriteBodyFontSizeId;
    }
    const legacy = localStorage.getItem(LEGACY_BODY_FONT_SIZE_PX_KEY);
    if (legacy) {
      const n = parseInt(legacy, 10);
      if (Number.isFinite(n)) {
        const id = nearestFontSizeId(Math.min(24, Math.max(14, n)));
        localStorage.setItem(WRITE_BODY_FONT_SIZE_KEY, id);
        localStorage.removeItem(LEGACY_BODY_FONT_SIZE_PX_KEY);
        return id;
      }
    }
  } catch {
    /* ignore */
  }
  return "md";
}

export function parseBatchChapterCountInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(20, Math.round(n)));
}

export interface SelectionPanel {
  mode: SelectionMode;
  start: number;
  end: number;
  text: string;
  streaming: string;
}

export interface SelectionMenuPos {
  top: number;
  left: number;
}
