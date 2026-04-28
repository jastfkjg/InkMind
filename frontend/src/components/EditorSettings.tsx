import { useMemo, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import {
  LINE_HEIGHT_IDS,
  LINE_HEIGHT_LABEL_KEYS,
  LINE_HEIGHT_VALUES,
  LINE_WIDTH_IDS,
  LINE_WIDTH_LABEL_KEYS,
  LINE_WIDTH_MAX_WIDTHS,
  WRITE_BODY_FONT_SIZE_IDS,
  WRITE_BODY_FONT_SIZE_LABEL_KEYS,
  WRITE_BODY_FONT_SIZE_PX,
  type LineHeightId,
  type LineWidthId,
  type WriteBodyFontSizeId,
} from "@/types/write";

export interface EditorSettingsProps {
  bodyFontSizeId: WriteBodyFontSizeId;
  lineHeightId: LineHeightId;
  lineWidthId: LineWidthId;
  focusMode: boolean;
  onBodyFontSizeChange: (id: WriteBodyFontSizeId) => void;
  onLineHeightChange: (id: LineHeightId) => void;
  onLineWidthChange: (id: LineWidthId) => void;
  onFocusModeChange: (enabled: boolean) => void;
}

export default function EditorSettings({
  bodyFontSizeId,
  lineHeightId,
  lineWidthId,
  focusMode,
  onBodyFontSizeChange,
  onLineHeightChange,
  onLineWidthChange,
  onFocusModeChange,
}: EditorSettingsProps) {
  const { t } = useI18n();
  const [sizeMenuOpen, setSizeMenuOpen] = useState(false);
  const [lineHeightMenuOpen, setLineHeightMenuOpen] = useState(false);
  const [lineWidthMenuOpen, setLineWidthMenuOpen] = useState(false);
  const sidebarToolsRef = useRef<HTMLDivElement | null>(null);

  const WRITE_BODY_FONT_SIZES = useMemo(
    () =>
      WRITE_BODY_FONT_SIZE_IDS.map((id) => ({
        id,
        label: t(WRITE_BODY_FONT_SIZE_LABEL_KEYS[id]),
        px: WRITE_BODY_FONT_SIZE_PX[id],
      })),
    [t]
  );

  const LINE_HEIGHTS = useMemo(
    () =>
      LINE_HEIGHT_IDS.map((id) => ({
        id,
        label: t(LINE_HEIGHT_LABEL_KEYS[id]),
        value: LINE_HEIGHT_VALUES[id],
      })),
    [t]
  );

  const LINE_WIDTHS = useMemo(
    () =>
      LINE_WIDTH_IDS.map((id) => ({
        id,
        label: t(LINE_WIDTH_LABEL_KEYS[id]),
        maxWidth: LINE_WIDTH_MAX_WIDTHS[id],
      })),
    [t]
  );

  const bodyFontSizeIndex = (() => {
    const i = WRITE_BODY_FONT_SIZES.findIndex((x) => x.id === bodyFontSizeId);
    return i >= 0 ? i : 2;
  })();

  const closeAllMenus = () => {
    setSizeMenuOpen(false);
    setLineHeightMenuOpen(false);
    setLineWidthMenuOpen(false);
  };

  return (
    <div className="write-sidenav-tools" ref={sidebarToolsRef}>
      <div className="write-size-picker">
        <button
          type="button"
          className="write-icon-btn write-size-menu-btn"
          title={t("write_font_size")}
          aria-expanded={sizeMenuOpen}
          aria-haspopup="dialog"
          aria-label={t("write_font_size")}
          onClick={() => {
            setLineHeightMenuOpen(false);
            setLineWidthMenuOpen(false);
            setSizeMenuOpen((v) => !v);
          }}
        >
          <span className="write-size-icon" aria-hidden>
            <span className="write-size-icon-lg">A</span>
            <span className="write-size-icon-sm">a</span>
          </span>
        </button>
        {sizeMenuOpen ? (
          <div className="write-size-popover" role="dialog" aria-label={t("write_adjust_font_size")}>
            <div className="write-size-slider-row">
              <span className="write-size-slider-a write-size-slider-a--min" aria-hidden>
                A
              </span>
              <div className="write-size-slider-shell">
                <div className="write-size-slider-track-bg" aria-hidden />
                <div className="write-size-slider-ticks" aria-hidden>
                  {WRITE_BODY_FONT_SIZES.map((_, i) => {
                    const last = WRITE_BODY_FONT_SIZES.length - 1;
                    if (i === 0 || i === last) return null;
                    return (
                      <span
                        key={i}
                        className="write-size-slider-tick"
                        style={{ left: `${(i / last) * 100}%` }}
                      />
                    );
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
                  aria-valuetext={
                    WRITE_BODY_FONT_SIZES.find((x) => x.id === bodyFontSizeId)?.label ?? t("write_font_size_md")
                  }
                  onChange={(e) => {
                    const i = Number(e.target.value);
                    const row = WRITE_BODY_FONT_SIZES[i];
                    if (row) onBodyFontSizeChange(row.id);
                  }}
                />
              </div>
              <span className="write-size-slider-a write-size-slider-a--max" aria-hidden>
                A
              </span>
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
          onClick={() => {
            setSizeMenuOpen(false);
            setLineWidthMenuOpen(false);
            setLineHeightMenuOpen((v) => !v);
          }}
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
                  onClick={() => {
                    onLineHeightChange(lh.id);
                    setLineHeightMenuOpen(false);
                  }}
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
          onClick={() => {
            setSizeMenuOpen(false);
            setLineHeightMenuOpen(false);
            setLineWidthMenuOpen((v) => !v);
          }}
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
                  onClick={() => {
                    onLineWidthChange(lw.id);
                    setLineWidthMenuOpen(false);
                  }}
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
        className={`write-icon-btn write-focus-btn${focusMode ? " is-active" : ""}`}
        title={focusMode ? t("write_exit_focus_mode_shortcut") : t("write_focus_mode_shortcut")}
        aria-label={t("write_focus_mode")}
        onClick={() => onFocusModeChange(!focusMode)}
      >
        <span className="write-focus-icon" aria-hidden>
          {focusMode ? "◆" : "◇"}
        </span>
      </button>
    </div>
  );
}
