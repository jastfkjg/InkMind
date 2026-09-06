import { useMemo } from "react";
import { useI18n } from "@/i18n";
import { reviewSegments, reviewedContent } from "@/utils/previewReview";

type Snapshot = { title: string; summary: string; content: string };
type Props = { original: Snapshot; proposal: Snapshot; rejected: Set<number>; useMetadata: boolean; disabled: boolean; onReview: (rejected: Set<number>, content: string) => void; onMetadata: (value: boolean) => void };
export default function GenerationReview({ original, proposal, rejected, useMetadata, disabled, onReview, onMetadata }: Props) {
  const { t } = useI18n();
  const segments = useMemo(() => reviewSegments(original.content, proposal.content), [original.content, proposal.content]);
  const changes = segments.map((segment, index) => ({ ...segment, index })).filter((segment) => segment.changed);
  const update = (next: Set<number>) => onReview(next, reviewedContent(segments, next));
  return <div className="generation-review">
    <p className="muted">{t("review_hint")}</p>
    <div className="review-actions"><button className="btn btn-ghost" disabled={disabled} onClick={() => update(new Set())}>{t("review_accept_all")}</button><button className="btn btn-ghost" disabled={disabled} onClick={() => update(new Set(changes.map((s) => s.index)))}>{t("review_keep_all")}</button></div>
    {(original.title !== proposal.title || original.summary !== proposal.summary) && <details className="review-change">
      <summary>{t("review_metadata")}</summary>
      <label><input type="checkbox" checked={useMetadata} disabled={disabled} onChange={(e) => onMetadata(e.target.checked)} />{t("review_use_metadata")}</label>
      <small>{t("review_original")}</small><p>{[original.title, original.summary].join("\n")}</p>
      <small>{t("review_proposal")}</small><p>{[proposal.title, proposal.summary].join("\n")}</p>
    </details>}
    {!changes.length && <p>{t("review_unchanged")}</p>}
    {changes.map((change, position) => <section className={`review-change${rejected.has(change.index) ? " is-rejected" : ""}`} key={change.index}>
      <label><input type="checkbox" disabled={disabled} checked={!rejected.has(change.index)} onChange={(e) => { const next = new Set(rejected); if (e.target.checked) next.delete(change.index); else next.add(change.index); update(next); }} />{t("review_change").replace("{count}", String(position + 1))}</label>
      {change.before && <><small>{t("review_original")}</small><p className="review-before">{change.before}</p></>}
      <small>{t("review_proposal")}</small><p className="review-after">{change.after || t("review_delete")}</p>
    </section>)}
  </div>;
}
