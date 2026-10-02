import { useI18n } from "@/i18n";
import { reviewedContent, type ReviewSegment } from "@/utils/previewReview";
import type { ChapterEvaluateResult } from "@/api/client";

type Snapshot = { title: string; summary: string; content: string };
type Props = {
  original: Snapshot; proposal: Snapshot; segments: ReviewSegment[];
  rejected: Set<number>; useTitle: boolean; useSummary: boolean; disabled: boolean; activeChange: number;
  report?: ChapterEvaluateResult | null;
  onReview: (rejected: Set<number>, content: string) => void;
  onTitle: (value: boolean) => void; onSummary: (value: boolean) => void; onLocate: (index: number) => void;
};
export default function GenerationReview({ original, proposal, segments, rejected, useTitle, useSummary, disabled, activeChange, report, onReview, onTitle, onSummary, onLocate }: Props) {
  const { t } = useI18n();
  const changes = segments.map((segment, index) => ({ ...segment, index })).filter((segment) => segment.changed);
  const update = (next: Set<number>) => onReview(next, reviewedContent(segments, next));
  return <div className="generation-review">
    <p className="muted">{t("review_selection_hint")}</p>
    {report && <details className="review-change">
      <summary>{t("write_deai_score").replace("{score}", String(report.de_ai_score))}</summary>
      <small>{t("write_evaluate_issues")} · {report.issues.length}</small>
      {report.issues.map((issue, index) => <p key={index}><strong>{issue.aspect}</strong><br />{issue.detail}</p>)}
    </details>}
    <div className="review-actions">
      <button className="btn btn-ghost" disabled={disabled || !changes.length} onClick={() => update(new Set())}>{t("review_select_all")}</button>
      <button className="btn btn-ghost" disabled={disabled || !changes.length} onClick={() => update(new Set(changes.map((s) => s.index)))}>{t("review_keep_all")}</button>
    </div>
    {(["title", "summary"] as const).map((field) => original[field] !== proposal[field] && <details className="review-change" key={field}>
      <summary>{t(field === "title" ? "review_title_change" : "review_summary_change")}</summary>
      <label><input type="checkbox" checked={field === "title" ? useTitle : useSummary} disabled={disabled} onChange={(e) => (field === "title" ? onTitle : onSummary)(e.target.checked)} />{t(field === "title" ? "review_use_title" : "review_use_summary")}</label>
      <small>{t("review_original")}</small><p>{original[field] || t("review_empty")}</p>
      <small>{t("review_proposal")}</small><p>{proposal[field] || t("review_empty")}</p>
    </details>)}
    {!changes.length && <p>{t("review_unchanged")}</p>}
    {changes.map((change, position) => <section className={`review-change review-change--compact${rejected.has(change.index) ? " is-rejected" : ""}${activeChange === change.index ? " is-current" : ""}`} key={change.index}>
      <label><input type="checkbox" disabled={disabled} checked={!rejected.has(change.index)} onChange={(e) => {
        const next = new Set(rejected); if (e.target.checked) next.delete(change.index); else next.add(change.index); update(next);
      }} />{t("review_select_change").replace("{count}", String(position + 1))}</label>
      <button className="review-locate" aria-label={t("review_locate").replace("{count}", String(position + 1))} onClick={() => onLocate(change.index)}>
        <span>{(change.after || change.before).trim()}</span><small>{t("review_locate_short")}</small>
      </button>
    </section>)}
  </div>;
}
