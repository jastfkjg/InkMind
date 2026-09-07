import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import type { ChapterEvaluateResult } from "@/api/client";
import type { AiOperation } from "./useAiOperation";

type Props = { operation: AiOperation; onCancel: () => void; onDismiss: () => void; onEdit?: (text: string) => void; report?: ChapterEvaluateResult | null };
export default function AiOperationPanel({ operation: op, onCancel, onDismiss, onEdit, report }: Props) {
  const { t } = useI18n();
  const [now, setNow] = useState(Date.now());
  const [following, setFollowing] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const readPosition = useRef(0);
  const running = op.status === "running";
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  useEffect(() => { followRef.current = true; setFollowing(true); }, [op.id]);
  useLayoutEffect(() => {
    if (running && followRef.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [op.text, running]);
  useLayoutEffect(() => {
    if (op.status === "ready" && editRef.current) editRef.current.scrollTop = followRef.current ? editRef.current.scrollHeight : readPosition.current;
  }, [op.status]);
  const seconds = (start: number) => Math.max(0, Math.floor(((op.endedAt ?? now) - start) / 1000));
  const count = Array.from(op.text.replace(/\s/g, "")).length;
  const waiting = running && now - op.lastActivityAt >= 15000;
  const status = running ? op.phase : t(op.status === "ready" ? "ai_stream_ready" : op.status === "cancelled" ? "ai_stream_cancelled" : op.status === "error" ? "ai_stream_failed" : "ai_stream_done");
  return <section className="write-ai-stream" aria-label={op.label}>
    <header className="write-ai-stream__header">
      <div><strong>{op.label}</strong><p role="status" aria-live="polite">{status}</p></div>
      {running ? <button type="button" className="btn btn-ghost" onClick={onCancel}>{t("ai_stream_cancel")}</button>
        : op.status !== "ready" && <button type="button" className="btn btn-ghost" onClick={onDismiss}>{t("write_close")}</button>}
    </header>
    <div className="write-ai-stream__meta">
      <span>{t("ai_stream_elapsed").replace("{seconds}", String(seconds(op.startedAt)))}</span>
      {running && <span>{t("ai_stream_phase_elapsed").replace("{seconds}", String(seconds(op.phaseStartedAt)))}</span>}
      {count > 0 && <span>{t("ai_stream_count").replace("{count}", String(count))}</span>}
    </div>
    {waiting && <p className="write-ai-stream__notice" role="status">{t("ai_stream_waiting")}</p>}
    {op.error && <p className="write-ai-stream__notice" role="alert">{op.error}</p>}
    {(op.status === "cancelled" || op.status === "error") && <p className="write-ai-stream__notice">{t("ai_stream_partial")}</p>}
    <details className="write-ai-stream__steps"><summary>{t("ai_stream_steps")}</summary><ol>{op.phases.map((phase, i) => <li key={i}>{phase}</li>)}</ol></details>
    {report && !running && <div className="write-ai-stream__report">
      <strong>{t("write_deai_score").replace("{score}", String(report.de_ai_score))}</strong>
      <details><summary>{t("write_evaluate_issues")} · {report.issues.length}</summary>
        {report.issues.map((issue, i) => <p key={i}><strong>{issue.aspect}</strong><br />{issue.detail}</p>)}
      </details>
    </div>}
    {op.text ? <>
      <p className="write-ai-stream__caption">{t(op.kind === "evaluate" ? (running ? "ai_stream_observations" : "write_ai_check_result_title") : "ai_stream_draft")}</p>
      {onEdit && op.status === "ready" ? <textarea ref={editRef} className="textarea write-ai-stream__edit" aria-label={t("ai_stream_edit")} value={op.text} onChange={(event) => onEdit(event.target.value)} />
        : <div ref={scrollRef} className="write-ai-stream__text" tabIndex={0} role="region" aria-label={t(op.kind === "evaluate" ? "write_ai_check_result_title" : "ai_stream_draft")} onScroll={() => {
          const node = scrollRef.current;
          if (!node) return;
          readPosition.current = node.scrollTop;
          const atEnd = node.scrollHeight - node.scrollTop - node.clientHeight < 32;
          followRef.current = atEnd; setFollowing(atEnd);
        }}>{op.text}</div>}
      {!following && running && <button type="button" className="btn btn-ghost" onClick={() => {
        followRef.current = true; setFollowing(true);
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }}>{t("ai_stream_follow")}</button>}
    </> : running && <p className="write-ai-stream__notice">{t("ai_stream_preparing")}</p>}
  </section>;
}
