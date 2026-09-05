import { memo, useEffect, useMemo, useState } from "react";
import { SettingOutlined } from "@ant-design/icons";
import { useI18n } from "@/i18n";
import type { LineHeightId, LineWidthId, WriteBodyFontSizeId, TypewriterModeId } from "./types";

const LINE_HEIGHT_IDS: LineHeightId[] = ["compact", "normal", "relaxed", "loose"];
const LINE_HEIGHT_VALUES: Record<LineHeightId, number> = { compact: 1.6, normal: 1.85, relaxed: 2.0, loose: 2.2 };
const LINE_HEIGHT_LABEL_KEYS: Record<LineHeightId, string> = {
  compact: "write_line_height_compact",
  normal: "write_line_height_normal",
  relaxed: "write_line_height_relaxed",
  loose: "write_line_height_loose",
};
const WRITE_LINE_HEIGHT_KEY = "inkmind_write_line_height";

const LINE_WIDTH_IDS: LineWidthId[] = ["md", "lg", "full"];
const LINE_WIDTH_MAX_WIDTHS: Record<LineWidthId, string | null> = { md: "55ch", lg: "68ch", full: null };
const LINE_WIDTH_LABEL_KEYS: Record<LineWidthId, string> = { md: "write_line_width_md", lg: "write_line_width_lg", full: "write_line_width_full" };
const WRITE_LINE_WIDTH_KEY = "inkmind_write_line_width";
const WRITE_FOCUS_MODE_KEY = "inkmind_write_focus_mode";
const WRITE_TYPEWRITER_MODE_KEY = "inkmind_write_typewriter_mode";

const WRITE_BODY_FONT_SIZE_IDS: WriteBodyFontSizeId[] = ["xs", "sm", "md", "lg", "xl", "xxl"];
const WRITE_BODY_FONT_SIZE_PX: Record<WriteBodyFontSizeId, number> = { xs: 14, sm: 16, md: 17, lg: 19, xl: 21, xxl: 24 };
const WRITE_BODY_FONT_SIZE_LABEL_KEYS: Record<WriteBodyFontSizeId, string> = {
  xs: "write_font_size_xs", sm: "write_font_size_sm", md: "write_font_size_md",
  lg: "write_font_size_lg", xl: "write_font_size_xl", xxl: "write_font_size_xxl",
};
const WRITE_BODY_FONT_SIZE_KEY = "inkmind_write_body_font_size";
const LEGACY_BODY_FONT_SIZE_PX_KEY = "inkmind_write_body_font_size_px";

function nearestFontSizeId(px: number): WriteBodyFontSizeId {
  let best = WRITE_BODY_FONT_SIZE_IDS[0];
  let d = Math.abs(px - WRITE_BODY_FONT_SIZE_PX[best]);
  for (const id of WRITE_BODY_FONT_SIZE_IDS) {
    const dd = Math.abs(px - WRITE_BODY_FONT_SIZE_PX[id]);
    if (dd < d) { d = dd; best = id; }
  }
  return best;
}

function readStoredBodyFontSizeId(): WriteBodyFontSizeId {
  try {
    const v = localStorage.getItem(WRITE_BODY_FONT_SIZE_KEY);
    if (v && WRITE_BODY_FONT_SIZE_IDS.includes(v as WriteBodyFontSizeId)) return v as WriteBodyFontSizeId;
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
  } catch { /* ignore */ }
  return "md";
}

function readStoredLineHeight(): LineHeightId {
  try {
    const v = localStorage.getItem(WRITE_LINE_HEIGHT_KEY);
    if (v && LINE_HEIGHT_IDS.includes(v as LineHeightId)) return v as LineHeightId;
  } catch { /* ignore */ }
  return "normal";
}

const LEGACY_LINE_WIDTH_MAP: Record<string, LineWidthId> = {
  narrow: "md", medium: "md", wide: "lg", full: "full",
  xs: "md", sm: "md", lg: "lg", xl: "lg", "2xl": "lg",
};

function readStoredLineWidth(): LineWidthId {
  try {
    const v = localStorage.getItem(WRITE_LINE_WIDTH_KEY);
    if (v) {
      if (LINE_WIDTH_IDS.includes(v as LineWidthId)) return v as LineWidthId;
      const mapped = LEGACY_LINE_WIDTH_MAP[v];
      if (mapped) { localStorage.setItem(WRITE_LINE_WIDTH_KEY, mapped); return mapped; }
    }
  } catch { /* ignore */ }
  return "full";
}

function readStoredFocusMode(): boolean {
  try { return localStorage.getItem(WRITE_FOCUS_MODE_KEY) === "true"; } catch { return false; }
}

function readStoredTypewriterMode(): TypewriterModeId {
  try {
    const v = localStorage.getItem(WRITE_TYPEWRITER_MODE_KEY);
    if (v === "on" || v === "off") return v;
  } catch { /* ignore */ }
  return "off";
}

export interface EditorSettingsState {
  bodyFontSizeId: WriteBodyFontSizeId;
  lineHeightId: LineHeightId;
  lineWidthId: LineWidthId;
  focusMode: boolean;
  typewriterMode: TypewriterModeId;
  bodyFontSizePx: number;
}

export function useEditorSettings(): EditorSettingsState & {
  setBodyFontSizeId: (id: WriteBodyFontSizeId) => void;
  setLineHeightId: (id: LineHeightId) => void;
  setLineWidthId: (id: LineWidthId) => void;
  setFocusMode: (fn: (v: boolean) => boolean) => void;
  setTypewriterMode: (id: TypewriterModeId) => void;
} {
  const [bodyFontSizeId, setBodyFontSizeId] = useState<WriteBodyFontSizeId>(readStoredBodyFontSizeId);
  const [lineHeightId, setLineHeightId] = useState<LineHeightId>(readStoredLineHeight);
  const [lineWidthId, setLineWidthId] = useState<LineWidthId>(readStoredLineWidth);
  const [focusMode, setFocusModeRaw] = useState<boolean>(readStoredFocusMode);
  const [typewriterMode, setTypewriterMode] = useState<TypewriterModeId>(readStoredTypewriterMode);

  const setFocusMode = (fn: (v: boolean) => boolean) => setFocusModeRaw(fn);

  useEffect(() => { localStorage.setItem(WRITE_BODY_FONT_SIZE_KEY, bodyFontSizeId); }, [bodyFontSizeId]);
  useEffect(() => { localStorage.setItem(WRITE_LINE_HEIGHT_KEY, lineHeightId); }, [lineHeightId]);
  useEffect(() => { localStorage.setItem(WRITE_LINE_WIDTH_KEY, lineWidthId); }, [lineWidthId]);
  useEffect(() => { localStorage.setItem(WRITE_FOCUS_MODE_KEY, String(focusMode)); }, [focusMode]);
  useEffect(() => { localStorage.setItem(WRITE_TYPEWRITER_MODE_KEY, typewriterMode); }, [typewriterMode]);

  return {
    bodyFontSizeId, setBodyFontSizeId,
    lineHeightId, setLineHeightId,
    lineWidthId, setLineWidthId,
    focusMode, setFocusMode,
    typewriterMode, setTypewriterMode,
    bodyFontSizePx: WRITE_BODY_FONT_SIZE_PX[bodyFontSizeId],
  };
}

interface EditorSettingsProps {
  settings: ReturnType<typeof useEditorSettings>;
  sidebarToolsRef: React.RefObject<HTMLDivElement>;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onDrawerClose?: () => void;
}

export default memo(function EditorSettings({ settings, sidebarToolsRef, sidebarOpen, onToggleSidebar, onDrawerClose }: EditorSettingsProps) {
  const { t } = useI18n();
  const { bodyFontSizeId, setBodyFontSizeId, lineHeightId, setLineHeightId, lineWidthId, setLineWidthId, focusMode, setFocusMode, typewriterMode, setTypewriterMode } = settings;

  const [sizeMenuOpen, setSizeMenuOpen] = useState(false);
  const [lineHeightMenuOpen, setLineHeightMenuOpen] = useState(false);
  const [lineWidthMenuOpen, setLineWidthMenuOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

  const LINE_HEIGHTS = useMemo(
    () => LINE_HEIGHT_IDS.map((id) => ({ id, label: t(LINE_HEIGHT_LABEL_KEYS[id]), value: LINE_HEIGHT_VALUES[id] })),
    [t]
  );
  const LINE_WIDTHS = useMemo(
    () => LINE_WIDTH_IDS.map((id) => ({ id, label: t(LINE_WIDTH_LABEL_KEYS[id]), maxWidth: LINE_WIDTH_MAX_WIDTHS[id] })),
    [t]
  );
  const WRITE_BODY_FONT_SIZES = useMemo(
    () => WRITE_BODY_FONT_SIZE_IDS.map((id) => ({ id, label: t(WRITE_BODY_FONT_SIZE_LABEL_KEYS[id]), px: WRITE_BODY_FONT_SIZE_PX[id] })),
    [t]
  );

  const bodyFontSizeIndex = WRITE_BODY_FONT_SIZES.findIndex((x) => x.id === bodyFontSizeId);
  const currentBodyFontSize = WRITE_BODY_FONT_SIZES.find((x) => x.id === bodyFontSizeId) ?? WRITE_BODY_FONT_SIZES[2];

  useEffect(() => {
    if (!sizeMenuOpen && !lineHeightMenuOpen && !lineWidthMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (sidebarToolsRef.current && !sidebarToolsRef.current.contains(e.target as Node)) {
        setSizeMenuOpen(false);
        setLineHeightMenuOpen(false);
        setLineWidthMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSizeMenuOpen(false);
        setLineHeightMenuOpen(false);
        setLineWidthMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [sizeMenuOpen, lineHeightMenuOpen, lineWidthMenuOpen, sidebarToolsRef]);

  useEffect(() => {
    if (focusMode) {
      setToolsOpen(false);
      onDrawerClose?.();
    }
  }, [focusMode]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="write-sidenav-toggle">
      <button
        type="button"
        className="write-icon-btn"
        title={sidebarOpen ? t("write_close_sidebar") : t("write_open_sidebar")}
        aria-label={sidebarOpen ? t("write_close_sidebar") : t("write_open_sidebar")}
        aria-expanded={sidebarOpen}
        onClick={onToggleSidebar}
      >
        <span className="write-icon-hamburger" aria-hidden>
          <span /><span /><span />
        </span>
      </button>
      <button type="button" className="write-icon-btn" title={t("write_editor_settings")} aria-label={t("write_editor_settings")} aria-expanded={toolsOpen} onClick={() => setToolsOpen((value) => !value)}>
        <SettingOutlined aria-hidden="true" />
      </button>
      <button type="button" className={`write-icon-btn write-focus-btn${focusMode ? " is-active" : ""}`} title={focusMode ? t("write_exit_focus_mode_shortcut") : t("write_focus_mode_shortcut")} aria-label={t("write_focus_mode")} aria-pressed={focusMode} onClick={() => setFocusMode((value) => !value)}>
        <span className="write-focus-icon" aria-hidden><span /><span /><span /><span /></span>
      </button>
      <div className="write-sidenav-tools" ref={sidebarToolsRef} hidden={!toolsOpen}>
        <div className="write-size-picker">
          <button
            type="button"
            className="write-icon-btn write-size-menu-btn"
            title={t("write_font_size")}
            aria-expanded={sizeMenuOpen}
            aria-haspopup="dialog"
            aria-label={t("write_font_size")}
            onClick={() => { setLineHeightMenuOpen(false); setLineWidthMenuOpen(false); setSizeMenuOpen((v) => !v); }}
          >
            <span className="write-size-icon" aria-hidden>
              <span className="write-size-icon-lg">A</span>
              <span className="write-size-icon-sm">a</span>
              <span className="write-size-icon-rule" />
            </span>
          </button>
          {sizeMenuOpen ? (
            <div className="write-size-popover" role="dialog" aria-label={t("write_adjust_font_size")}>
              <div className="write-size-popover-head">
                <span>{t("write_font_size")}</span>
                <strong>{currentBodyFontSize.label} · {currentBodyFontSize.px}px</strong>
              </div>
              <div className="write-size-preview" style={{ fontSize: `${currentBodyFontSize.px}px` }}>Aa</div>
              <div className="write-size-slider-row">
                <span className="write-size-slider-a write-size-slider-a--min" aria-hidden>A</span>
                <div className="write-size-slider-shell">
                  <div className="write-size-slider-track-bg" aria-hidden />
                  <div className="write-size-slider-ticks" aria-hidden>
                    {WRITE_BODY_FONT_SIZES.map((_, i) => {
                      const last = WRITE_BODY_FONT_SIZES.length - 1;
                      if (i === 0 || i === last) return null;
                      return <span key={i} className="write-size-slider-tick" style={{ left: `${(i / last) * 100}%` }} />;
                    })}
                  </div>
                  <input
                    type="range"
                    className="write-size-range"
                    min={0}
                    max={WRITE_BODY_FONT_SIZES.length - 1}
                    step={1}
                    value={bodyFontSizeIndex}
                    aria-valuemin={0}
                    aria-valuemax={WRITE_BODY_FONT_SIZES.length - 1}
                    aria-valuenow={bodyFontSizeIndex}
                    aria-valuetext={WRITE_BODY_FONT_SIZES.find((x) => x.id === bodyFontSizeId)?.label ?? t("write_font_size_md")}
                    onChange={(e) => {
                      const i = Number(e.target.value);
                      const row = WRITE_BODY_FONT_SIZES[i];
                      if (row) setBodyFontSizeId(row.id);
                    }}
                  />
                </div>
                <span className="write-size-slider-a write-size-slider-a--max" aria-hidden>A</span>
              </div>
            </div>
          ) : null}
        </div>

        <div className="write-line-height-picker">
          <button
            type="button"
            className="write-icon-btn write-line-height-btn"
            title={t("write_line_height")}
            aria-expanded={lineHeightMenuOpen}
            aria-haspopup="listbox"
            aria-label={t("write_line_height")}
            onClick={() => { setSizeMenuOpen(false); setLineWidthMenuOpen(false); setLineHeightMenuOpen((v) => !v); }}
          >
            <span className="write-line-height-icon" aria-hidden>
              <span className="write-line-height-line" />
              <span className="write-line-height-line" />
              <span className="write-line-height-line" />
            </span>
          </button>
          {lineHeightMenuOpen ? (
            <ul className="write-line-height-menu" role="listbox" aria-label={t("write_select_line_height")}>
              {LINE_HEIGHTS.map((lh) => (
                <li key={lh.id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={lineHeightId === lh.id}
                    className={`write-line-height-option${lineHeightId === lh.id ? " is-active" : ""}`}
                    onClick={() => { setLineHeightId(lh.id); setLineHeightMenuOpen(false); }}
                  >
                    {lh.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="write-line-width-picker">
          <button
            type="button"
            className="write-icon-btn write-line-width-btn"
            title={t("write_line_width")}
            aria-expanded={lineWidthMenuOpen}
            aria-haspopup="listbox"
            aria-label={t("write_line_width")}
            onClick={() => { setSizeMenuOpen(false); setLineHeightMenuOpen(false); setLineWidthMenuOpen((v) => !v); }}
          >
            <span className="write-line-width-icon" aria-hidden>
              <span className="write-line-width-bar write-line-width-bar--short" />
              <span className="write-line-width-bar write-line-width-bar--medium" />
              <span className="write-line-width-bar write-line-width-bar--long" />
            </span>
          </button>
          {lineWidthMenuOpen ? (
            <ul className="write-line-width-menu" role="listbox" aria-label={t("write_select_line_width")}>
              {LINE_WIDTHS.map((lw) => (
                <li key={lw.id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={lineWidthId === lw.id}
                    className={`write-line-width-option${lineWidthId === lw.id ? " is-active" : ""}`}
                    onClick={() => { setLineWidthId(lw.id); setLineWidthMenuOpen(false); }}
                  >
                    {lw.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <button
          type="button"
          className={`write-icon-btn write-typewriter-btn${typewriterMode === "on" ? " is-active" : ""}`}
          title={typewriterMode === "on" ? t("write_typewriter_mode_on") : t("write_typewriter_mode_off")}
          aria-label={t("write_typewriter_mode")}
          onClick={() => setTypewriterMode(typewriterMode === "on" ? "off" : "on")}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="5" width="14" height="9" rx="1.5" />
            <line x1="5" y1="8" x2="5" y2="11" />
            <line x1="9" y1="8" x2="9" y2="11" />
            <line x1="13" y1="8" x2="13" y2="11" />
            <line x1="7" y1="11" x2="11" y2="11" />
            <path d="M6 5V3.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V5" />
          </svg>
        </button>
      </div>
    </div>
  );
}, function areEqual(prev: EditorSettingsProps, next: EditorSettingsProps) {
  if (prev.sidebarOpen !== next.sidebarOpen) return false;
  if (prev.sidebarToolsRef !== next.sidebarToolsRef) return false;
  if (prev.onToggleSidebar !== next.onToggleSidebar) return false;
  if (prev.onDrawerClose !== next.onDrawerClose) return false;
  const ps = prev.settings;
  const ns = next.settings;
  return ps.bodyFontSizeId === ns.bodyFontSizeId
    && ps.lineHeightId === ns.lineHeightId
    && ps.lineWidthId === ns.lineWidthId
    && ps.focusMode === ns.focusMode
    && ps.typewriterMode === ns.typewriterMode
    && ps.bodyFontSizePx === ns.bodyFontSizePx;
});
