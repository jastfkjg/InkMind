import { useI18n } from "@/i18n";
import type { SelectionMode, SelectionPanel, SelectionMenuPos } from "@/types/write";

export interface SelectionToolbarProps {
  showSelectionBar: boolean;
  selectionMenuPos: SelectionMenuPos | null;
  selectionPanel: SelectionPanel | null;
  busy: boolean;
  onExpand: () => void;
  onPolish: () => void;
  onClosePanel: () => void;
  onReplace: () => void;
  onCopy: () => void;
  onRegenerate: () => void;
}

export default function SelectionToolbar({
  showSelectionBar,
  selectionMenuPos,
  selectionPanel,
  busy,
  onExpand,
  onPolish,
  onClosePanel,
  onReplace,
  onCopy,
  onRegenerate,
}: SelectionToolbarProps) {
  const { t } = useI18n();

  return (
    <>
      {showSelectionBar && selectionMenuPos && (
        <div
          className="write-selection-float"
          role="toolbar"
          aria-label={t("write_selection_ai_aria")}
          style={{ top: selectionMenuPos.top, left: selectionMenuPos.left }}
        >
          <button
            type="button"
            className="write-selection-float__item"
            disabled={busy}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onExpand}
          >
            <svg className="write-selection-float__icon" viewBox="0 0 24 24" aria-hidden>
              <path
                fill="currentColor"
                d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
              />
            </svg>
            {t("write_selection_expand")}
          </button>
          <button
            type="button"
            className="write-selection-float__item"
            disabled={busy}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onPolish}
          >
            <svg
              className="write-selection-float__icon write-selection-float__icon--stroke"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
              />
            </svg>
            {t("write_selection_polish")}
          </button>
        </div>
      )}

      {selectionPanel && (
        <div
          className="write-selection-overlay"
          role="presentation"
          onClick={onClosePanel}
        >
          <div
            className="write-selection-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="write-selection-card-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="write-selection-card-title" className="write-selection-card__title">
              {selectionPanel.mode === "expand"
                ? t("write_selection_expand_title")
                : t("write_selection_polish_title")}
            </h2>
            <div className="write-selection-card__body">
              {selectionPanel.streaming || (busy ? t("write_generating") : "")}
            </div>
            <p className="write-selection-card__disclaimer">
              {t("write_selection_disclaimer")}
            </p>
            <div className="write-selection-card__actions">
              <button
                type="button"
                className="btn btn-primary write-selection-card__replace"
                disabled={busy || !selectionPanel.text.trim()}
                onClick={onReplace}
              >
                {t("write_selection_replace")}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy || !selectionPanel.text.trim()}
                onClick={onCopy}
              >
                {t("write_selection_copy")}
              </button>
              <button type="button" className="btn btn-ghost" onClick={onClosePanel}>
                {t("write_selection_exit")}
              </button>
              <div className="write-selection-card__actions-right">
                <button
                  type="button"
                  className="write-selection-icon-btn"
                  title={t("write_selection_regenerate")}
                  aria-label={t("write_selection_regenerate")}
                  disabled={busy}
                  onClick={onRegenerate}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
