import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  apiErrorMessage,
  createChapter,
  deleteChapter,
  fetchChapters,
  fetchLlmProviders,
  generateChapter,
  updateChapter,
} from "@/api/client";
import type { Chapter } from "@/types";

const LLM_LABEL: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  qwen: "通义千问",
  deepseek: "DeepSeek",
};

function llmLabel(id: string) {
  return LLM_LABEL[id] ?? id;
}

export default function NovelWrite() {
  const { novelId } = useParams();
  const id = Number(novelId);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [genSummary, setGenSummary] = useState("");
  const [llmOptions, setLlmOptions] = useState<string[]>([]);
  const [llm, setLlm] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState("");

  const loadChapters = useCallback(async () => {
    const list = await fetchChapters(id);
    setChapters(list);
    return list;
  }, [id]);

  useEffect(() => {
    (async () => {
      setErr("");
      try {
        const [list, meta] = await Promise.all([fetchChapters(id), fetchLlmProviders()]);
        setChapters(list);
        setLlmOptions(meta.available);
        setLlm(meta.available.includes(meta.default) ? meta.default : meta.available[0] || "");
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

  async function onSaveChapter() {
    if (!activeId) return;
    setSaving(true);
    setErr("");
    try {
      const ch = await updateChapter(id, activeId, { title, summary, content });
      setChapters((prev) => prev.map((c) => (c.id === ch.id ? ch : c)));
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
      const ch = await createChapter(id, { title: `第 ${list.length + 1} 章`, sort_order: nextOrder });
      const full = await loadChapters();
      setChapters(full);
      setActiveId(ch.id);
      setTitle(ch.title);
      setSummary(ch.summary);
      setContent(ch.content);
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

  async function onGenerate(replaceCurrent: boolean) {
    const s = genSummary.trim();
    if (!s) {
      setErr("请先填写本章概要");
      return;
    }
    setGenerating(true);
    setErr("");
    try {
      const ch = await generateChapter(id, s, replaceCurrent && activeId ? activeId : null, llm || null);
      const full = await loadChapters();
      setChapters(full);
      setActiveId(ch.id);
      setTitle(ch.title);
      setSummary(ch.summary);
      setContent(ch.content);
      setGenSummary("");
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return <p className="muted">加载章节…</p>;
  }

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
                onClick={() => setActiveId(c.id)}
              >
                {c.title?.trim() || `章节 #${c.id}`}
              </button>
            ))
          )}
        </div>
      </div>

      <div>
        {err ? <p className="form-error">{err}</p> : null}

        <div className="card" style={{ marginBottom: "1rem" }}>
          <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "1.1rem", margin: "0 0 0.75rem" }}>根据概要生成正文</h2>
          <p className="hint">模型会结合你在「写作前设定」中的大纲、类型、文风，以及「人物与关系」中的内容生成。</p>
          <div className="field">
            <label htmlFor="gen">本章概要</label>
            <textarea
              id="gen"
              className="textarea"
              value={genSummary}
              onChange={(e) => setGenSummary(e.target.value)}
              rows={4}
              placeholder="写出本章剧情要点，例如出场人物与冲突…"
            />
          </div>
          {llmOptions.length > 0 ? (
            <div className="field">
              <label htmlFor="llm">模型</label>
              <select id="llm" className="input" value={llm} onChange={(e) => setLlm(e.target.value)}>
                {llmOptions.map((o) => (
                  <option key={o} value={o}>
                    {llmLabel(o)}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="form-error" style={{ marginTop: 0 }}>
              后端未配置任何 LLM（如 OPENAI、ANTHROPIC、QWEN、DEEPSEEK 的 API Key），无法生成。请在环境变量中配置至少一种后重启服务。
            </p>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={generating || llmOptions.length === 0}
              onClick={() => onGenerate(false)}
            >
              {generating ? "生成中…" : "生成到新章节"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={generating || !activeId || llmOptions.length === 0}
              onClick={() => onGenerate(true)}
            >
              覆盖当前章
            </button>
          </div>
        </div>

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
                <label>本章概要（可编辑，用于下次生成参考）</label>
                <textarea className="textarea" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
              </div>
              <div className="field">
                <label>正文</label>
                <textarea
                  className="textarea editor-body"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="在此写作或粘贴内容…"
                />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
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
