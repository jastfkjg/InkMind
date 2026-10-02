import { useLayoutEffect, useRef } from "react";
import { useI18n } from "@/i18n";
import type { ReviewSegment } from "@/utils/previewReview";

export type ReviewView = "draft" | "original" | "diff";
type Props = {
  original: string; draft: string; segments: ReviewSegment[]; rejected: Set<number>;
  view: ReviewView; activeChange: number; disabled: boolean; fontSize: number; lineHeight: number;
  onView: (view: ReviewView) => void; onLocate: (index: number) => void; onEdit: (text: string) => void;
};
export default function ReviewDocument({ original, draft, segments, rejected, view, activeChange, disabled, fontSize, lineHeight, onView, onLocate, onEdit }: Props) {
  const { t } = useI18n();
  const scroll = useRef<HTMLDivElement>(null);
  const changes = segments.map((s, i) => s.changed ? i : -1).filter((i) => i >= 0);
  const position = changes.indexOf(activeChange);
  const selected = changes.filter((i) => !rejected.has(i)).length;
  useLayoutEffect(() => {
    if (view !== "diff") return;
    const container = scroll.current;
    const target = container?.querySelector<HTMLElement>(`[data-review-segment="${activeChange}"]`);
    if (container && target) container.scrollTop += target.getBoundingClientRect().top - container.getBoundingClientRect().top - 16;
  }, [activeChange, view]);
  return <section className="review-document" aria-label={t("review_workspace")}>
    <div className="review-document__toolbar">
      <div role="group" aria-label={t("review_view")}>
        {(["draft", "original", "diff"] as const).map((value) => <button className="btn btn-ghost" key={value} aria-pressed={view === value} onClick={() => onView(value)}>{t(`review_view_${value}`)}</button>)}
      </div>
      <span role="status">{t("review_count").replace("{total}", String(changes.length)).replace("{selected}", String(selected))}</span>
      <div className="review-document__navigation">
        <button className="btn btn-ghost" disabled={position <= 0} onClick={() => onLocate(changes[position - 1])}>{t("review_previous")}</button>
        <button className="btn btn-ghost" disabled={!changes.length || position >= changes.length - 1} onClick={() => onLocate(changes[position + 1])}>{t("review_next")}</button>
      </div>
    </div>
    {view === "draft" ? <textarea className="review-document__draft" aria-label={t("ai_stream_edit")} value={draft} disabled={disabled} style={{ fontSize, lineHeight }} onChange={(e) => onEdit(e.target.value)} />
      : <div ref={scroll} className="review-document__reading" tabIndex={0} aria-label={t(`review_view_${view}`)} style={{ fontSize, lineHeight }}>
        {view === "original" ? <div className="review-document__original">{original || t("review_empty")}</div>
          : segments.map((segment, i) => <div data-review-segment={i} key={i} className={`review-document__segment${segment.changed ? " is-changed" : ""}${i === activeChange ? " is-current" : ""}`}>
            {segment.changed ? <>
              <div className="review-document__change-label">{t(rejected.has(i) ? "review_kept_original" : "review_selected_change")}</div>
              {segment.before && <div className="review-document__before"><small>{t("review_original")}</small><div>{segment.before}</div></div>}
              <div className="review-document__after"><small>{t("review_proposal")}</small><div>{segment.after || t("review_delete")}</div></div>
            </> : segment.after}
          </div>)}
      </div>}
  </section>;
}
