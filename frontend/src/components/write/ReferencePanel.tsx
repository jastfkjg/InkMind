import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiErrorMessage, createMemo, fetchCharacters, fetchMemos } from "@/api/client";
import { useI18n } from "@/i18n";
import type { Character, Memo, Novel } from "@/types";

type Props = { novel: Novel; userId: number; open: boolean; onClose: () => void };
export default function ReferencePanel({ novel, userId, open, onClose }: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"settings" | "people" | "memos">("people");
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Character[]>([]);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);
  const draftKey = `inkmind_reference_draft:${userId}:${novel.id}`;
  const [draft, setDraft] = useState(() => {
    try { const value = JSON.parse(localStorage.getItem(draftKey) || "null"); if (typeof value?.title === "string" && typeof value?.body === "string") return { title: value.title, body: value.body }; } catch { /* optional recovery */ }
    return { title: "", body: "" };
  });
  const panelRef = useRef<HTMLElement>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    try { if (draft.title || draft.body) localStorage.setItem(draftKey, JSON.stringify(draft)); else localStorage.removeItem(draftKey); } catch { /* writing remains available */ }
  }, [draft, draftKey]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true); setError("");
    Promise.all([fetchCharacters(novel.id), fetchMemos(novel.id)])
      .then(([characters, notes]) => { if (!cancelled) { setPeople(characters); setMemos(notes); } })
      .catch((e) => { if (!cancelled) setError(apiErrorMessage(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, novel.id, reload]);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLButtonElement>(".write-ai-close")?.focus({ preventScroll: true });
    return () => { if (opener?.isConnected && panelRef.current?.contains(document.activeElement)) opener.focus({ preventScroll: true }); };
  }, [open]);
  async function saveMemo() {
    if (!draft.body.trim() || saving) return;
    setSaving(true); setError(""); setSaved(false);
    try {
      const memo = await createMemo(novel.id, { title: draft.title.trim(), body: draft.body });
      try { localStorage.removeItem(draftKey); } catch { /* optional storage */ }
      if (mounted.current) { setMemos((items) => [memo, ...items]); setDraft({ title: "", body: "" }); setSaved(true); }
    } catch (e) { if (mounted.current) setError(apiErrorMessage(e)); }
    finally { if (mounted.current) setSaving(false); }
  }
  const search = query.trim().toLocaleLowerCase();
  const filteredPeople = people.filter((p) => `${p.name} ${p.profile} ${p.notes}`.toLocaleLowerCase().includes(search));
  const filteredMemos = memos.filter((m) => `${m.title} ${m.body}`.toLocaleLowerCase().includes(search));
  return (
    <aside ref={panelRef} className="write-reference-panel" hidden={!open} aria-label={t("reference_title")} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div className="write-ai-drawer-head"><strong>{t("reference_title")}</strong><button className="btn btn-ghost write-ai-close" onClick={onClose}>{t("write_close")}</button></div>
      <div className="reference-tabs" role="group" aria-label={t("reference_category")}>
        {(["settings", "people", "memos"] as const).map((key) => <button key={key} aria-pressed={tab === key} onClick={() => { setTab(key); setQuery(""); }}>{t(`novel_tab_${key}`)}</button>)}
      </div>
      <div className="reference-body">
        {error && <p className="form-error" role="alert">{error} <button className="btn btn-ghost" onClick={() => setReload((v) => v + 1)}>{t("write_retry_save")}</button></p>}
        {tab !== "settings" && <input type="search" className="input" value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t("reference_search")} placeholder={t("reference_search")} />}
        {loading && <p role="status" className="muted">{t("common_loading")}</p>}
        {tab === "settings" && <>
          <section className="reference-entry"><h4>{t("writing_style")}</h4><p>{novel.writing_style || t("reference_not_set")}</p></section>
          <section className="reference-entry"><h4>{t("background_setting")}</h4><p>{novel.background || t("reference_not_set")}</p></section>
        </>}
        {tab === "people" && filteredPeople.map((person) => <details className="reference-entry" key={person.id}>
          <summary>{person.name}</summary><p>{person.profile}</p>{person.notes && <><h4>{t("novel_tab_memos")}</h4><p>{person.notes}</p></>}
          <Link to={`/novels/${novel.id}/people/${person.id}/edit`}>{t("people_edit_character")}</Link>
        </details>)}
        {tab === "memos" && <>
          <details className="reference-quick-memo" open={Boolean(draft.title || draft.body) || undefined}>
            <summary>{t("reference_quick_memo")}</summary>
            <form onSubmit={(e) => { e.preventDefault(); void saveMemo(); }}>
              <label htmlFor="reference-memo-title">{t("reference_memo_title")}</label>
              <input id="reference-memo-title" className="input" value={draft.title} disabled={saving} maxLength={512} onChange={(e) => { setSaved(false); setDraft({ ...draft, title: e.target.value }); }} />
              <label htmlFor="reference-memo-body">{t("reference_memo_body")}</label>
              <textarea id="reference-memo-body" className="textarea" rows={5} value={draft.body} disabled={saving} onChange={(e) => { setSaved(false); setDraft({ ...draft, body: e.target.value }); }} />
              <small className="muted">{t("reference_draft_hint")}</small>
              <button className="btn btn-primary" disabled={saving || !draft.body.trim()}>{saving ? t("write_saving") : t("reference_save_memo")}</button>
            </form>
          </details>
          {saved && <p role="status">{t("reference_memo_saved")}</p>}
          {filteredMemos.map((memo) => <details className="reference-entry" key={memo.id}><summary>{memo.title || memo.body.slice(0, 30)}</summary><p>{memo.body}</p><Link to={`/novels/${novel.id}/memos/${memo.id}/edit`}>{t("common_edit")}</Link></details>)}
        </>}
        {!loading && ((tab === "people" && !filteredPeople.length) || (tab === "memos" && !filteredMemos.length)) && <p className="muted">{search ? t("write_search_empty") : t("reference_empty")}</p>}
      </div>
      <div className="reference-footer"><Link to={`/novels/${novel.id}/${tab}`}>{t("reference_manage")}</Link></div>
    </aside>
  );
}
