import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  apiErrorMessage,
  createChapter,
  deleteChapter,
  fetchChapters,
  fetchLlmProviders,
  generateChapter,
  reviseChapter,
  updateChapter,
} from "@/api/client";
import { useAuth } from "@/context/AuthContext";
import type { Chapter } from "@/types";

export default function NovelWrite() {
  const { novelId } = useParams();
  const id = Number(novelId);
  const { user } = useAuth();
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [reviseHint, setReviseHint] = useState("");
  const [aiMode, setAiMode] = useState<"rewrite" | "append">("rewrite");
  const [llmOptions, setLlmOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [revising, setRevising] = useState(false);
  const [err, setErr] = useState("");
  const activeIdRef = useRef<number | null>(null);
  activeIdRef.current = activeId;

  const loadChapters = useCallback(async () => {
    const list = await fetchChapters(id);
    setChapters(list);
    return list;
  }, [id]);

  const preferredLlm = user?.preferred_llm_provider ?? null;

  useEffect(() => {
    (async () => {
      setErr("");
      try {
        const [list, meta] = await Promise.all([fetchChapters(id), fetchLlmProviders()]);
        setChapters(list);
        setLlmOptions(meta.available);
        if (list.length > 0) {
          const first = list[0];
          setActiveId(first.id);
          setTitle(first.title);
          setSummary(first.summary);
          setContent(first.content);
        } else {
          setActiveId(null);
          setTitle("");
          setSummary("");
          setContent("");
        }
      } catch (e) {
        setErr(apiErrorMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  useEffect(() => {
    const ch = chapters.find((c) => c.id === activeId);
    if (!ch) {
      if (activeId === null) {
        setTitle("");
        setSummary("");
        setContent("");
      }
      return;
    }
    setTitle(ch.title);
    setSummary(ch.summary);
    setContent(ch.content);
  }, [activeId, chapters]);

  const hasBody = (content || "").trim().length > 0;

  function scheduleMergeAsyncSummary() {
    window.setTimeout(async () => {
      try {
        const list = await fetchChapters(id);
        const aid = activeIdRef.current;
        setChapters(list);
        const u = aid ? list.find((x) => x.id === aid) : undefined;
        if (u) {
          setSummary(u.summary);
          setTitle(u.title);
        }
      } catch {
        /* ignore */
      }
    }, 2800);
  }

  async function onSaveChapter() {
    if (!activeId) return;
    setSaving(true);
    setErr("");
    const before = chapters.find((c) => c.id === activeId);
    const contentChanged =
      before !== undefined && (before.content || "").trim() !== (content || "").trim();
    try {
      const ch = await updateChapter(id, activeId, { title, summary, content });
      setChapters((prev) => prev.map((c) => (c.id === ch.id ? ch : c)));
      setSummary(ch.summary);
      if (contentChanged) {
        scheduleMergeAsyncSummary();
      }
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function onAddChapter() {
    setErr("");
    try {
      const list = await loadChapters();
      const nextOrder = list.length ? Math.max(...list.map((c) => c.sort_order)) + 1 : 0;
      const ch = await createChapter(id, { title: "", sort_order: nextOrder });
      const full = await loadChapters();
      setChapters(full);
      setActiveId(ch.id);
      setTitle(ch.title);
      setSummary(ch.summary);
      setContent(ch.content);
      setReviseHint("");
    } catch (e) {
      setErr(apiErrorMessage(e));
    }
  }

  async function onDeleteChapter() {
    if (!activeId) return;
    if (!window.confirm("确定删除本章？")) return;
    setErr("");
    try {
      await deleteChapter(id, activeId);
      const full = await loadChapters();
      setChapters(full);
      setReviseHint("");
      if (full.length > 0) {
        const n = full[0];
        setActiveId(n.id);
        setTitle(n.title);
        setSummary(n.summary);
        setContent(n.content);
      } else {
        setActiveId(null);
        setTitle("");
        setSummary("");
        setContent("");
      }
    } catch (e) {
      setErr(apiErrorMessage(e));
    }
  }

  /** 根据当前「摘要」生成正文：无正文时写入本章，有正文时覆盖 */
  async function onGenerateFromSummary() {
    const s = summary.trim();
    if (!s) {
      setErr("请先填写本章摘要");
      return;
    }
    if (!activeId) return;
    if (hasBody) {
      const ok = window.confirm("将根据当前摘要重新生成正文并覆盖现有内容，是否继续？");
      if (!ok) return;
    }
    setGenerating(true);
    setErr("");
    try {
      const ch = await generateChapter(id, s, activeId, preferredLlm);
      const full = await loadChapters();
      setChapters(full);
      setActiveId(ch.id);
      setTitle(ch.title);
      setSummary(ch.summary);
      setContent(ch.content);
      setReviseHint("");
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setGenerating(false);
    }
  }

  async function onAiAssistant() {
    if (!activeId || !reviseHint.trim()) {
      setErr("请填写说明");
      return;
    }
    if (aiMode === "rewrite" && !hasBody) {
      setErr("整体修改需要已有正文；可先「生成」正文，或切换到「增加」");
      return;
    }
    setRevising(true);
    setErr("");
    try {
      const ch = await reviseChapter(id, activeId, reviseHint.trim(), preferredLlm, aiMode);
      const full = await loadChapters();
      setChapters(full);
      setSummary(ch.summary);
      setContent(ch.content);
      setReviseHint("");
      scheduleMergeAsyncSummary();
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setRevising(false);
    }
  }

  if (loading) {
    return <p className="muted">加载章节…</p>;
  }

  const genLabel = hasBody ? "生成并覆盖" : "生成";
  const genHint = hasBody
    ? "根据上方摘要重新生成正文，将覆盖当前正文。"
    : "根据上方摘要生成本章正文。";

  return (
    <div className="grid-2">
      <div className="card" style={{ padding: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <strong>章节</strong>
          <button type="button" className="btn btn-ghost" style={{ fontSize: "0.85rem" }} onClick={onAddChapter}>
            新建章节
          </button>
        </div>
        <div className="chapter-list stack-sm">
          {chapters.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              暂无章节，点击「新建章节」。
            </p>
          ) : (
            chapters.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`chapter-item${c.id === activeId ? " active" : ""}`}
                onClick={() => {
                  setActiveId(c.id);
                  setReviseHint("");
                }}
              >
                {c.title?.trim() || `章节 #${c.id}`}
              </button>
            ))
          )}
        </div>
      </div>

      <div>
        {err ? <p className="form-error">{err}</p> : null}

        <div className="card">
          {activeId ? (
            <>
              <input
                className="editor-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="章节标题"
              />
              <div className="field">
                <label>摘要</label>
                <p className="hint" style={{ marginTop: 0 }}>
                  若修改了正文，摘要在后台由模型生成，约数秒后自动刷新。可在改摘要后用下方按钮重新生成正文。
                </p>
                <textarea className="textarea" rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} />
              </div>

              {llmOptions.length > 0 ? (
                <div className="field" style={{ marginBottom: "1.25rem" }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={generating}
                    onClick={onGenerateFromSummary}
                  >
                    {generating ? "生成中…" : genLabel}
                  </button>
                  <p className="hint" style={{ marginTop: "0.35rem", marginBottom: 0 }}>
                    {genHint}
                  </p>
                </div>
              ) : (
                <p className="form-error" style={{ marginBottom: "1rem" }}>
                  未配置 LLM，无法根据摘要生成正文。
                </p>
              )}

              <div className="field">
                <label>正文</label>
                <textarea
                  className="textarea editor-body"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="在此写作或粘贴内容…"
                />
              </div>

              {activeId && llmOptions.length > 0 ? (
                <div className="field" style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
                  <label style={{ fontSize: "1.05rem", fontFamily: "var(--font-serif)" }}>AI助手</label>
                  <div className="ai-mode-row" style={{ marginBottom: "0.65rem" }}>
                    <label className="ai-mode-option">
                      <input
                        type="radio"
                        name="aiMode"
                        checked={aiMode === "rewrite"}
                        onChange={() => setAiMode("rewrite")}
                      />
                      修改（整体改写）
                    </label>
                    <label className="ai-mode-option">
                      <input
                        type="radio"
                        name="aiMode"
                        checked={aiMode === "append"}
                        onChange={() => setAiMode("append")}
                      />
                      增加（仅追加内容）
                    </label>
                  </div>
                  <textarea
                    className="textarea"
                    rows={3}
                    value={reviseHint}
                    onChange={(e) => setReviseHint(e.target.value)}
                    placeholder={
                      aiMode === "rewrite"
                        ? "例如：加强对话节奏、删去重复描写…"
                        : "例如：接一段主角回忆、补一场对话…（将接在正文末尾）"
                    }
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ marginTop: "0.5rem" }}
                    disabled={revising}
                    onClick={onAiAssistant}
                  >
                    {revising ? "处理中…" : aiMode === "rewrite" ? "应用修改" : "应用追加"}
                  </button>
                </div>
              ) : null}
              {activeId && llmOptions.length === 0 ? (
                <p className="muted" style={{ marginTop: "0.5rem" }}>
                  未配置 LLM 时无法使用 AI 助手。
                </p>
              ) : null}

              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "1rem" }}>
                <button type="button" className="btn btn-primary" disabled={saving} onClick={onSaveChapter}>
                  {saving ? "保存中…" : "保存本章"}
                </button>
                <button type="button" className="btn btn-danger" onClick={onDeleteChapter}>
                  删除本章
                </button>
              </div>
            </>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              请选择左侧章节，或新建一章。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
