import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  apiErrorMessage,
  createChapter,
  deleteChapter,
  fetchChapters,
  fetchLlmProviders,
  generateChapter,
  novelAiChat,
  novelAiNaming,
  reviseChapter,
  updateChapter,
} from "@/api/client";
import { useAuth } from "@/context/AuthContext";
import type { Chapter } from "@/types";

type AiTool = "generate" | "rewrite" | "append" | "naming" | "ask";

const RAIL_ITEMS: { key: AiTool; line2: string }[] = [
  { key: "generate", line2: "生成" },
  { key: "rewrite", line2: "改写" },
  { key: "append", line2: "追加" },
  { key: "naming", line2: "起名" },
  { key: "ask", line2: "提问" },
];

export default function NovelWrite() {
  const { novelId } = useParams();
  const id = Number(novelId);
  const { user } = useAuth();
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightTool, setRightTool] = useState<AiTool | null>(null);
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 900 : false
  );

  const [rewriteInstr, setRewriteInstr] = useState("");
  const [appendInstr, setAppendInstr] = useState("");
  const [namingCategory, setNamingCategory] = useState<"character" | "item" | "skill" | "other">("character");
  const [namingDesc, setNamingDesc] = useState("");
  const [namingHint, setNamingHint] = useState("");
  const [namingResult, setNamingResult] = useState("");
  const [askHistory, setAskHistory] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [askInput, setAskInput] = useState("");

  const [llmOptions, setLlmOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const drawerEndRef = useRef<HTMLDivElement | null>(null);
  const activeIdRef = useRef<number | null>(null);
  activeIdRef.current = activeId;
  const novelIdRef = useRef(id);
  novelIdRef.current = id;
  const lastLoadedChapterIdRef = useRef<number | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorSnapshotRef = useRef({ title: "", summary: "", content: "" });
  editorSnapshotRef.current = { title, summary, content };

  const loadChapters = useCallback(async () => {
    const list = await fetchChapters(id);
    setChapters(list);
    return list;
  }, [id]);

  const preferredLlm = user?.preferred_llm_provider ?? null;

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 900);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!Number.isFinite(id)) return;

    lastLoadedChapterIdRef.current = null;
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    setLoading(true);
    setErr("");
    setChapters([]);
    setActiveId(null);
    setTitle("");
    setSummary("");
    setContent("");

    let cancelled = false;
    (async () => {
      try {
        const [list, meta] = await Promise.all([fetchChapters(id), fetchLlmProviders()]);
        if (cancelled || novelIdRef.current !== id) return;
        setChapters(list);
        setLlmOptions(meta.available);
        if (list.length > 0) {
          setActiveId(list[0].id);
        } else {
          setActiveId(null);
        }
      } catch (e) {
        if (!cancelled && novelIdRef.current === id) {
          setErr(apiErrorMessage(e));
        }
      } finally {
        if (!cancelled && novelIdRef.current === id) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    setAskHistory([]);
    setAskInput("");
  }, [id]);

  useEffect(() => {
    if (activeId === null) {
      lastLoadedChapterIdRef.current = null;
      setTitle("");
      setSummary("");
      setContent("");
      return;
    }
    if (lastLoadedChapterIdRef.current === activeId) {
      return;
    }
    const ch = chapters.find((c) => c.id === activeId);
    if (!ch) {
      return;
    }
    lastLoadedChapterIdRef.current = activeId;
    setTitle(ch.title);
    setSummary(ch.summary);
    setContent(ch.content);
  }, [activeId, chapters]);

  useEffect(() => {
    drawerEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [askHistory, rightTool]);

  const hasBody = (content || "").trim().length > 0;
  const hasLlm = llmOptions.length > 0;

  function needsChapter(tool: AiTool): boolean {
    return tool === "generate" || tool === "rewrite" || tool === "append";
  }

  function canOpenTool(tool: AiTool): boolean {
    if (!hasLlm) return false;
    if (needsChapter(tool)) return activeId !== null;
    return true;
  }

  async function flushSave(): Promise<void> {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    const aid = activeIdRef.current;
    if (aid === null) return;
    const { title: t, summary: s, content: c } = editorSnapshotRef.current;
    const before = chapters.find((x) => x.id === aid);
    if (!before) return;
    if (before.title === t && before.summary === s && before.content === c) return;
    const ch = await updateChapter(id, aid, { title: t, summary: s, content: c });
    setChapters((prev) => prev.map((x) => (x.id === ch.id ? ch : x)));
  }

  async function selectChapter(cid: number) {
    if (cid === activeId) return;
    setErr("");
    try {
      await flushSave();
    } catch (e) {
      setErr(apiErrorMessage(e));
      return;
    }
    setActiveId(cid);
    if (narrow) setSidebarOpen(false);
  }

  useEffect(() => {
    if (activeId === null) return;
    const snap = chapters.find((c) => c.id === activeId);
    if (!snap) return;
    if (snap.title === title && snap.summary === summary && snap.content === content) return;
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    const scheduledForId = activeId;
    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      if (activeIdRef.current !== scheduledForId) return;
      void (async () => {
        try {
          const ch = await updateChapter(id, scheduledForId, { title, summary, content });
          setChapters((prev) => prev.map((c) => (c.id === ch.id ? ch : c)));
        } catch (e) {
          setErr(apiErrorMessage(e));
        }
      })();
    }, 850);
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [title, summary, content, activeId, id, chapters]);

  function toggleTool(t: AiTool) {
    if (!canOpenTool(t)) return;
    setRightTool((prev) => (prev === t ? null : t));
    setErr("");
  }

  async function onAddChapter() {
    const nid = id;
    setErr("");
    try {
      await flushSave();
      if (novelIdRef.current !== nid) return;
      const list = await loadChapters();
      if (novelIdRef.current !== nid) return;
      const nextOrder = list.length ? Math.max(...list.map((c) => c.sort_order)) + 1 : 0;
      const ch = await createChapter(nid, { title: "", sort_order: nextOrder });
      if (novelIdRef.current !== nid) return;
      const full = await loadChapters();
      if (novelIdRef.current !== nid) return;
      setChapters(full);
      setActiveId(ch.id);
      lastLoadedChapterIdRef.current = null;
      if (narrow) setSidebarOpen(false);
    } catch (e) {
      if (novelIdRef.current === nid) {
        setErr(apiErrorMessage(e));
      }
    }
  }

  async function onDeleteChapterById(cid: number) {
    const nid = id;
    if (!window.confirm("确定删除该章节？")) return;
    setErr("");
    try {
      await flushSave();
      if (novelIdRef.current !== nid) return;
      await deleteChapter(nid, cid);
      if (novelIdRef.current !== nid) return;
      const full = await loadChapters();
      if (novelIdRef.current !== nid) return;
      setChapters(full);
      lastLoadedChapterIdRef.current = null;
      if (cid === activeId) {
        if (full.length > 0) {
          setActiveId(full[0].id);
        } else {
          setActiveId(null);
          setTitle("");
          setSummary("");
          setContent("");
        }
      }
    } catch (e) {
      if (novelIdRef.current === nid) {
        setErr(apiErrorMessage(e));
      }
    }
  }

  async function onGenerate() {
    const nid = id;
    const s = summary.trim();
    if (!s) {
      setErr("请填写本章概要");
      return;
    }
    if (!activeId) return;
    if (hasBody) {
      const ok = window.confirm("将根据当前概要重新生成正文并覆盖现有内容，是否继续？");
      if (!ok) return;
    }
    setBusy(true);
    setErr("");
    try {
      const ch = await generateChapter(nid, s, {
        chapterId: activeId,
        title: title.trim() || null,
      });
      if (novelIdRef.current !== nid) return;
      const full = await loadChapters();
      if (novelIdRef.current !== nid) return;
      setChapters(full);
      setActiveId(ch.id);
      lastLoadedChapterIdRef.current = null;
      setTitle(ch.title);
      setSummary(ch.summary);
      setContent(ch.content);
    } catch (e) {
      if (novelIdRef.current === nid) {
        setErr(apiErrorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  }

  async function onRunRewrite() {
    const nid = id;
    if (!activeId || !rewriteInstr.trim()) {
      setErr("请填写改写说明");
      return;
    }
    if (!hasBody) {
      setErr("改写需要已有正文");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const ch = await reviseChapter(nid, activeId, rewriteInstr.trim(), preferredLlm, "rewrite");
      if (novelIdRef.current !== nid) return;
      const full = await loadChapters();
      if (novelIdRef.current !== nid) return;
      setChapters(full);
      setContent(ch.content);
      setSummary(ch.summary);
      setRewriteInstr("");
    } catch (e) {
      if (novelIdRef.current === nid) {
        setErr(apiErrorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  }

  async function onRunAppend() {
    const nid = id;
    if (!activeId || !appendInstr.trim()) {
      setErr("请填写要追加的内容说明");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const ch = await reviseChapter(nid, activeId, appendInstr.trim(), preferredLlm, "append");
      if (novelIdRef.current !== nid) return;
      const full = await loadChapters();
      if (novelIdRef.current !== nid) return;
      setChapters(full);
      setContent(ch.content);
      setSummary(ch.summary);
      setAppendInstr("");
    } catch (e) {
      if (novelIdRef.current === nid) {
        setErr(apiErrorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  }

  async function onRunNaming() {
    const d = namingDesc.trim();
    if (!d) {
      setErr("请说明要命名的对象");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const { text } = await novelAiNaming(id, {
        category: namingCategory,
        description: d,
        hint: namingHint || null,
      });
      setNamingResult(text);
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onAskSend() {
    const q = askInput.trim();
    if (!q) return;
    setBusy(true);
    setErr("");
    setAskInput("");
    try {
      const prior = askHistory.map((m) => ({ role: m.role, content: m.content }));
      const { reply } = await novelAiChat(id, {
        message: q,
        history: prior,
      });
      setAskHistory((h) => [
        ...h,
        { role: "user", content: q },
        { role: "assistant", content: reply },
      ]);
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="muted">加载章节…</p>;
  }

  const drawerOpen =
    rightTool && hasLlm && (activeId !== null || rightTool === "ask" || rightTool === "naming");

  return (
    <div className="write-shell">
      {err ? <p className="form-error write-err-banner">{err}</p> : null}

      {narrow && sidebarOpen ? (
        <button
          type="button"
          className="write-sidebar-backdrop"
          aria-label="关闭章节列表"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <div className={`write-workspace${sidebarOpen ? " write-workspace--sidebar-open" : ""}`}>
        <div className="write-sidenav-toggle">
          <button
            type="button"
            className="write-icon-btn"
            title={sidebarOpen ? "关闭边栏" : "打开边栏"}
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen((v) => !v)}
          >
            <span className="write-icon-hamburger" aria-hidden>
              <span />
              <span />
              <span />
            </span>
          </button>
        </div>

        <aside className={`write-left-sidebar${sidebarOpen ? " is-open" : ""}`}>
          <div className="write-left-inner card">
            <div className="write-left-head">
              <strong>章节</strong>
              <button type="button" className="btn btn-ghost" style={{ fontSize: "0.85rem" }} onClick={onAddChapter}>
                新建
              </button>
            </div>
            <div className="chapter-list stack-sm">
              {chapters.length === 0 ? (
                <p className="muted" style={{ margin: 0, fontSize: "0.88rem" }}>
                  暂无章节
                </p>
              ) : (
                chapters.map((c, idx) => (
                  <div key={c.id} className="chapter-row">
                    <button
                      type="button"
                      className={`chapter-item${c.id === activeId ? " active" : ""}`}
                      onClick={() => void selectChapter(c.id)}
                    >
                      {c.title?.trim() || `第 ${idx + 1} 章`}
                    </button>
                    <button
                      type="button"
                      className="chapter-del"
                      title="删除章节"
                      aria-label="删除章节"
                      onClick={(e) => {
                        e.stopPropagation();
                        void onDeleteChapterById(c.id);
                      }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>

        <div className="write-main write-main--with-rail">
          <div className="card write-editor-card">
            {activeId ? (
              <>
                <input
                  className="editor-title editor-title--compact"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="章节标题"
                />
                <div className="field write-body-field">
                  <textarea
                    className="textarea editor-body"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="正文内容"
                  />
                </div>
              </>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                请打开左侧边栏并选择章节，或新建一章。
              </p>
            )}
          </div>
        </div>
      </div>

      <nav className="write-ai-rail" aria-label="AI 功能">
        {RAIL_ITEMS.map(({ key, line2 }) => (
          <button
            key={key}
            type="button"
            className={`write-rail-btn${rightTool === key ? " active" : ""}`}
            disabled={!canOpenTool(key)}
            title={
              !hasLlm
                ? "未配置 LLM"
                : needsChapter(key) && !activeId
                  ? "请先选择章节"
                  : `AI${line2}`
            }
            onClick={() => toggleTool(key)}
          >
            <span className="write-rail-stack">
              <span className="write-rail-ai">AI</span>
              <span className="write-rail-name">{line2}</span>
            </span>
          </button>
        ))}
      </nav>

      {drawerOpen && rightTool ? (
        <div className="write-ai-drawer">
          <div className="write-ai-drawer-head">
            <span>
              {rightTool === "generate" && "AI 生成"}
              {rightTool === "rewrite" && "AI 改写"}
              {rightTool === "append" && "AI 追加"}
              {rightTool === "naming" && "AI 起名"}
              {rightTool === "ask" && "AI 提问"}
            </span>
            <button type="button" className="write-ai-close btn btn-ghost" onClick={() => setRightTool(null)}>
              关闭
            </button>
          </div>
          <div className="write-ai-drawer-body">
            {rightTool === "generate" && activeId ? (
              <div className="write-ai-section">
                <p className="hint">概要 + 可选章节标题；标题留空则由模型拟定。将写入本章并覆盖正文。</p>
                <div className="field">
                  <label>本章概要</label>
                  <textarea
                    className="textarea"
                    rows={5}
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    placeholder="本章要写的情节与要点…"
                  />
                </div>
                <div className="field">
                  <label>章节标题（可选）</label>
                  <input
                    className="input"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="若留空，由 AI 拟定章节标题"
                  />
                </div>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={onGenerate}>
                  {busy ? "生成中…" : hasBody ? "重新生成并覆盖" : "生成正文与标题"}
                </button>
              </div>
            ) : null}

            {rightTool === "rewrite" && activeId ? (
              <div className="write-ai-section">
                <p className="hint">说明希望如何修改正文，将整体替换为模型输出。</p>
                <textarea
                  className="textarea"
                  rows={5}
                  value={rewriteInstr}
                  onChange={(e) => setRewriteInstr(e.target.value)}
                  placeholder="例如：加强对话节奏、删去重复描写…"
                />
                <button type="button" className="btn btn-primary" disabled={busy} onClick={onRunRewrite}>
                  {busy ? "处理中…" : "应用改写"}
                </button>
              </div>
            ) : null}

            {rightTool === "append" && activeId ? (
              <div className="write-ai-section">
                <p className="hint">说明要在文末追加的内容，不会重复已有段落。</p>
                <textarea
                  className="textarea"
                  rows={5}
                  value={appendInstr}
                  onChange={(e) => setAppendInstr(e.target.value)}
                  placeholder="例如：接一段回忆、补一场对话…"
                />
                <button type="button" className="btn btn-primary" disabled={busy} onClick={onRunAppend}>
                  {busy ? "处理中…" : "应用追加"}
                </button>
              </div>
            ) : null}

            {rightTool === "naming" ? (
              <div className="write-ai-section">
                <p className="hint">为人物、物品、功法等请求备选名称（非章节标题）。</p>
                <div className="field">
                  <label>类别</label>
                  <select
                    className="input"
                    value={namingCategory}
                    onChange={(e) =>
                      setNamingCategory(e.target.value as typeof namingCategory)
                    }
                  >
                    <option value="character">人物 / 角色</option>
                    <option value="item">物品 / 器物</option>
                    <option value="skill">功法 / 招式</option>
                    <option value="other">其他</option>
                  </select>
                </div>
                <div className="field">
                  <label>要命名的对象</label>
                  <textarea
                    className="textarea"
                    rows={3}
                    value={namingDesc}
                    onChange={(e) => setNamingDesc(e.target.value)}
                    placeholder="例如：擅长用毒的黑市药师；上古飞剑；火系入门功法…"
                  />
                </div>
                <div className="field">
                  <label>补充（可选）</label>
                  <textarea
                    className="textarea textarea-compact"
                    rows={2}
                    value={namingHint}
                    onChange={(e) => setNamingHint(e.target.value)}
                    placeholder="字数、风格、避讳…"
                  />
                </div>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={onRunNaming}>
                  {busy ? "生成中…" : "生成备选名"}
                </button>
                {namingResult ? (
                  <pre className="write-ai-naming-out">{namingResult}</pre>
                ) : null}
              </div>
            ) : null}

            {rightTool === "ask" ? (
              <div className="write-ai-chat">
                <div className="write-ai-messages">
                  {askHistory.length === 0 ? (
                    <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
                      围绕本书设定提问，例如结构、人物、节奏等。
                    </p>
                  ) : (
                    askHistory.map((m, i) => (
                      <div
                        key={i}
                        className={`write-ai-bubble${m.role === "user" ? " write-ai-bubble--user" : ""}`}
                      >
                        {m.content}
                      </div>
                    ))
                  )}
                  <div ref={drawerEndRef} />
                </div>
                <div className="write-ai-chat-input">
                  <textarea
                    className="textarea textarea-compact"
                    rows={2}
                    value={askInput}
                    onChange={(e) => setAskInput(e.target.value)}
                    placeholder="输入问题…"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        onAskSend();
                      }
                    }}
                  />
                  <button type="button" className="btn btn-primary" disabled={busy || !askInput.trim()} onClick={onAskSend}>
                    发送
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
