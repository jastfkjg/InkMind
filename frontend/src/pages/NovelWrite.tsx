import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  apiErrorMessage,
  createChapter,
  deleteChapter,
  chapterSelectionAi,
  evaluateChapter,
  fetchChapters,
  fetchLlmProviders,
  generateChapter,
  generateChapterBatch,
  novelAiChat,
  novelAiChapterSummaryInspire,
  novelAiNaming,
  reviseChapter,
  updateChapter,
} from "@/api/client";
import { useAuth } from "@/context/AuthContext";
import type { Chapter } from "@/types";
import { normalizeBodyParagraphIndent } from "@/utils/bodyParagraphIndent";
import { getCaretViewportPoint } from "@/utils/textareaCaretViewport";

type AiTool = "generate" | "rewrite" | "append" | "naming" | "ask" | "evaluate";
type GenerateTab = "single" | "batch";

const RAIL_ITEMS: { key: AiTool; line2: string }[] = [
  { key: "generate", line2: "生成" },
  { key: "rewrite", line2: "改写" },
  { key: "append", line2: "追加" },
  { key: "naming", line2: "起名" },
  { key: "ask", line2: "提问" },
  { key: "evaluate", line2: "评估" },
];

const WRITE_BODY_FONT_KEY = "inkmind_write_body_font";

type WriteBodyFontId = "noto" | "song" | "kai" | "fang" | "hei" | "mono";

const WRITE_BODY_FONTS: { id: WriteBodyFontId; label: string }[] = [
  { id: "noto", label: "思源宋体（默认）" },
  { id: "song", label: "宋体" },
  { id: "kai", label: "楷体" },
  { id: "fang", label: "仿宋" },
  { id: "hei", label: "黑体" },
  { id: "mono", label: "等宽" },
];

/** Sample each option in the menu with its own font. */
const WRITE_FONT_PREVIEW: Record<WriteBodyFontId, string> = {
  noto: 'var(--font-serif), "Noto Serif SC", Georgia, serif',
  song: '"Songti SC", "SimSun", "Noto Serif SC", serif',
  kai: '"Kaiti SC", "KaiTi", "STKaiti", serif',
  fang: '"STFangsong", "FangSong", "SimFang", "Noto Serif SC", serif',
  hei: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif',
  mono: 'ui-monospace, "Cascadia Code", "Sarasa Mono SC", "Noto Sans Mono CJK SC", monospace',
};

function readStoredBodyFont(): WriteBodyFontId {
  try {
    const v = localStorage.getItem(WRITE_BODY_FONT_KEY);
    if (v && WRITE_BODY_FONTS.some((x) => x.id === v)) {
      return v as WriteBodyFontId;
    }
  } catch {
    /* ignore */
  }
  return "noto";
}

/** 正文字号分档（不展示像素，仅内部映射） */
type WriteBodyFontSizeId = "xs" | "sm" | "md" | "lg" | "xl" | "xxl";

const WRITE_BODY_FONT_SIZES: { id: WriteBodyFontSizeId; label: string; px: number }[] = [
  { id: "xs", label: "极小", px: 14 },
  { id: "sm", label: "小", px: 16 },
  { id: "md", label: "标准", px: 17 },
  { id: "lg", label: "大", px: 19 },
  { id: "xl", label: "较大", px: 21 },
  { id: "xxl", label: "特大", px: 24 },
];

const WRITE_BODY_FONT_SIZE_KEY = "inkmind_write_body_font_size";
const LEGACY_BODY_FONT_SIZE_PX_KEY = "inkmind_write_body_font_size_px";

function nearestFontSizeId(px: number): WriteBodyFontSizeId {
  let best = WRITE_BODY_FONT_SIZES[0];
  let d = Math.abs(px - best.px);
  for (const p of WRITE_BODY_FONT_SIZES) {
    const dd = Math.abs(px - p.px);
    if (dd < d) {
      d = dd;
      best = p;
    }
  }
  return best.id;
}

function readStoredBodyFontSizeId(): WriteBodyFontSizeId {
  try {
    const v = localStorage.getItem(WRITE_BODY_FONT_SIZE_KEY);
    if (v && WRITE_BODY_FONT_SIZES.some((x) => x.id === v)) {
      return v as WriteBodyFontSizeId;
    }
    const legacy = localStorage.getItem(LEGACY_BODY_FONT_SIZE_PX_KEY);
    if (legacy) {
      const n = parseInt(legacy, 10);
      if (Number.isFinite(n)) {
        const id = nearestFontSizeId(Math.min(24, Math.max(14, n)));
        localStorage.setItem(WRITE_BODY_FONT_SIZE_KEY, id);
        localStorage.removeItem(LEGACY_BODY_FONT_SIZE_PX_KEY);
        return id;
      }
    }
  } catch {
    /* ignore */
  }
  return "md";
}

function parseBatchChapterCountInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(20, Math.round(n)));
}

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
  const [bodyFontId, setBodyFontId] = useState<WriteBodyFontId>(() =>
    typeof window !== "undefined" ? readStoredBodyFont() : "noto"
  );
  const [bodyFontSizeId, setBodyFontSizeId] = useState<WriteBodyFontSizeId>(() =>
    typeof window !== "undefined" ? readStoredBodyFontSizeId() : "md"
  );
  const [fontMenuOpen, setFontMenuOpen] = useState(false);
  const [sizeMenuOpen, setSizeMenuOpen] = useState(false);
  const sidebarToolsRef = useRef<HTMLDivElement | null>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [rewriteInstr, setRewriteInstr] = useState("");
  const [appendInstr, setAppendInstr] = useState("");
  const [namingCategory, setNamingCategory] = useState<"character" | "item" | "skill" | "other">("character");
  const [namingDesc, setNamingDesc] = useState("");
  const [namingHint, setNamingHint] = useState("");
  const [namingResult, setNamingResult] = useState("");
  const [askHistory, setAskHistory] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [askInput, setAskInput] = useState("");
  const [evaluateBusy, setEvaluateBusy] = useState(false);
  const [evaluateResult, setEvaluateResult] = useState<{
    issues: { aspect: string; detail: string }[];
    de_ai_score: number;
  } | null>(null);

  const [llmOptions, setLlmOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [summaryInspireBusy, setSummaryInspireBusy] = useState(false);
  const [batchSummaryInspireBusy, setBatchSummaryInspireBusy] = useState(false);
  const [generateTab, setGenerateTab] = useState<GenerateTab>("single");
  const [singleGenerateTitle, setSingleGenerateTitle] = useState("");
  const [singleGenerateLockTitle, setSingleGenerateLockTitle] = useState(false);
  const [batchChapterCountInput, setBatchChapterCountInput] = useState("3");
  const [batchSummary, setBatchSummary] = useState("");
  const [batchStreaming, setBatchStreaming] = useState("");
  /** 正文选区：用于 AI 扩写/润色 */
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number } | null>(null);
  const [selectionPanel, setSelectionPanel] = useState<{
    mode: "expand" | "polish";
    start: number;
    end: number;
    text: string;
    streaming: string;
  } | null>(null);
  const [selectionMenuPos, setSelectionMenuPos] = useState<{ top: number; left: number } | null>(null);
  const selectionRangeRef = useRef<{ start: number; end: number } | null>(null);
  selectionRangeRef.current = selectionRange;
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
  const latestChapterId = chapters.length > 0 ? chapters[chapters.length - 1]?.id ?? null : null;
  const isLatestChapter = activeId !== null && latestChapterId === activeId;
  const batchChapterCount = parseBatchChapterCountInput(batchChapterCountInput);
  const showSingleInspireCta = !summary.trim();
  const showBatchInspireCta = !batchSummary.trim();

  const bodyFontSizePx = WRITE_BODY_FONT_SIZES.find((x) => x.id === bodyFontSizeId)?.px ?? 17;
  const bodyFontSizeIndex = (() => {
    const i = WRITE_BODY_FONT_SIZES.findIndex((x) => x.id === bodyFontSizeId);
    return i >= 0 ? i : 2;
  })();

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 900);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(WRITE_BODY_FONT_KEY, bodyFontId);
    } catch {
      /* ignore */
    }
  }, [bodyFontId]);

  useEffect(() => {
    try {
      localStorage.setItem(WRITE_BODY_FONT_SIZE_KEY, bodyFontSizeId);
    } catch {
      /* ignore */
    }
  }, [bodyFontSizeId]);

  useEffect(() => {
    if (!fontMenuOpen && !sizeMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (sidebarToolsRef.current && !sidebarToolsRef.current.contains(e.target as Node)) {
        setFontMenuOpen(false);
        setSizeMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFontMenuOpen(false);
        setSizeMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [fontMenuOpen, sizeMenuOpen]);

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
    setEvaluateResult(null);
    setGenerateTab("single");
    setSingleGenerateTitle("");
    setSingleGenerateLockTitle(false);
    setBatchChapterCountInput("3");
    setBatchSummary("");
    setBatchStreaming("");
    setSelectionRange(null);
    setSelectionPanel(null);
  }, [id]);

  useEffect(() => {
    setEvaluateResult(null);
    setSingleGenerateTitle("");
    setSingleGenerateLockTitle(false);
    setBatchChapterCountInput("3");
    setBatchSummary("");
    setBatchStreaming("");
    setSelectionRange(null);
    setSelectionPanel(null);
  }, [activeId]);

  useEffect(() => {
    if (!isLatestChapter && generateTab === "batch") {
      setGenerateTab("single");
    }
  }, [generateTab, isLatestChapter]);

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
    setContent(normalizeBodyParagraphIndent(ch.content));
  }, [activeId, chapters]);

  useEffect(() => {
    drawerEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [askHistory, rightTool]);

  useEffect(() => {
    if (!busy || rightTool !== "generate") return;
    const el = bodyTextareaRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [content, busy, rightTool]);

  const hasBody = (content || "").trim().length > 0;
  const hasLlm = llmOptions.length > 0;

  function captureSelection(): { start: number; end: number } | null {
    const ta = bodyTextareaRef.current;
    if (!ta) return null;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    if (s === e) return null;
    return { start: s, end: e };
  }

  function syncSelectionFromTextarea() {
    setSelectionRange(captureSelection());
  }

  useEffect(() => {
    if (!selectionPanel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectionPanel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectionPanel]);

  async function runSelectionAi(
    mode: "expand" | "polish",
    rangeOverride?: { start: number; end: number }
  ) {
    const r = rangeOverride ?? selectionRange ?? captureSelection();
    if (!r || r.start === r.end || activeId === null) return;
    const sel = content.slice(r.start, r.end);
    if (!sel.trim()) {
      setErr("请先选中要处理的文字");
      return;
    }
    if (!hasLlm) {
      setErr("未配置 LLM");
      return;
    }
    setErr("");
    setSelectionPanel({ mode, start: r.start, end: r.end, text: "", streaming: "" });
    setBusy(true);
    try {
      let acc = "";
      const { text } = await chapterSelectionAi(
        id,
        activeId,
        {
          mode,
          selected_text: sel,
          chapter_content: content,
          llm_provider: preferredLlm,
        },
        {
          onToken: (t) => {
            acc += t;
            setSelectionPanel((p) => (p ? { ...p, streaming: acc } : null));
          },
        }
      );
      setSelectionPanel((p) => (p ? { ...p, text, streaming: text } : null));
    } catch (e) {
      setSelectionPanel(null);
      setErr(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function closeSelectionPanel() {
    setSelectionPanel(null);
  }

  function applySelectionReplace() {
    if (!selectionPanel || !selectionPanel.text.trim()) return;
    const { start, end, text } = selectionPanel;
    setContent((c) => normalizeBodyParagraphIndent(c.slice(0, start) + text + c.slice(end)));
    setSelectionPanel(null);
    setSelectionRange(null);
    setSelectionMenuPos(null);
  }

  async function copySelectionResult() {
    if (!selectionPanel?.text) return;
    try {
      await navigator.clipboard.writeText(selectionPanel.text);
    } catch {
      setErr("复制失败，请手动复制");
    }
  }

  const showSelectionBar =
    Boolean(activeId) &&
    Boolean(selectionRange && selectionRange.start !== selectionRange.end) &&
    !selectionPanel;

  useLayoutEffect(() => {
    if (!showSelectionBar) {
      setSelectionMenuPos(null);
      return;
    }
    const ta = bodyTextareaRef.current;
    const r = selectionRangeRef.current;
    if (!ta || !r || r.start === r.end) {
      setSelectionMenuPos(null);
      return;
    }
    const update = () => {
      const t = bodyTextareaRef.current;
      const cur = selectionRangeRef.current;
      if (!t || !cur || cur.start === cur.end) return;
      const endPt = getCaretViewportPoint(t, cur.end);
      const startPt = getCaretViewportPoint(t, cur.start);
      const anchorTop = Math.min(endPt.top, startPt.top);
      const anchorLeft = endPt.left;
      setSelectionMenuPos({ top: anchorTop - 8, left: anchorLeft });
    };
    update();
    ta.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      ta.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [showSelectionBar, selectionRange, content, bodyFontSizePx, bodyFontId]);

  function needsChapter(tool: AiTool): boolean {
    return tool === "generate" || tool === "rewrite" || tool === "append" || tool === "evaluate";
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

  function handleBodyKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey) return;
    if (e.nativeEvent.isComposing) return;
    e.preventDefault();
    const el = e.currentTarget;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const insert = "\n\u3000\u3000";
    const next = content.slice(0, start) + insert + content.slice(end);
    setContent(next);
    const pos = start + insert.length;
    window.setTimeout(() => {
      const ta = bodyTextareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    }, 0);
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

  async function onSummaryInspire() {
    const nid = id;
    if (!activeId || !hasLlm) return;
    setSummaryInspireBusy(true);
    setErr("");
    let acc = "";
    try {
      await novelAiChapterSummaryInspire(
        nid,
        { chapter_id: activeId, chapter_count: 1 },
        (t) => {
          acc += t;
          if (novelIdRef.current === nid) setSummary(acc);
        }
      );
    } catch (e) {
      if (novelIdRef.current === nid) {
        setErr(apiErrorMessage(e));
      }
    } finally {
      setSummaryInspireBusy(false);
    }
  }

  async function onBatchSummaryInspire() {
    const nid = id;
    if (!activeId || !hasLlm) return;
    if (!isLatestChapter) {
      setErr("批量生成仅支持从最新章节开始");
      return;
    }
    if (!batchChapterCount) {
      setErr("请填写 1 到 20 之间的生成章节数");
      return;
    }
    setBatchSummaryInspireBusy(true);
    setErr("");
    let acc = "";
    try {
      await novelAiChapterSummaryInspire(
        nid,
        { chapter_id: activeId, chapter_count: batchChapterCount },
        (t) => {
          acc += t;
          if (novelIdRef.current === nid) setBatchSummary(acc);
        }
      );
    } catch (e) {
      if (novelIdRef.current === nid) {
        setErr(apiErrorMessage(e));
      }
    } finally {
      setBatchSummaryInspireBusy(false);
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
      const ok = window.confirm("将根据当前概要重新生成正文并覆盖现有内容，标题也可能随内容一起更新，是否继续？");
      if (!ok) return;
    }
    const savedContent = content;
    const savedTitle = title;
    setBusy(true);
    setErr("");
    setContent("");
    try {
      const ch = await generateChapter(nid, s, {
        chapterId: activeId,
        title: singleGenerateTitle.trim() || null,
        lockTitle: singleGenerateLockTitle,
        onToken: (t) => {
          if (novelIdRef.current === nid) setContent((p) => p + t);
        },
      });
      if (novelIdRef.current !== nid) return;
      const full = await loadChapters();
      if (novelIdRef.current !== nid) return;
      setChapters(full);
      setActiveId(ch.id);
      lastLoadedChapterIdRef.current = null;
      setTitle(ch.title);
      setSummary(ch.summary);
      setContent(normalizeBodyParagraphIndent(ch.content));
      setSingleGenerateTitle("");
      setSingleGenerateLockTitle(false);
    } catch (e) {
      if (novelIdRef.current === nid) {
        setErr(apiErrorMessage(e));
        setTitle(savedTitle);
        setContent(savedContent);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onBatchGenerate() {
    const nid = id;
    if (!activeId) return;
    if (!isLatestChapter) {
      setErr("批量生成仅支持从最新章节开始");
      return;
    }
    if (!batchChapterCount) {
      setErr("请填写 1 到 20 之间的生成章节数");
      return;
    }
    const total = batchSummary.trim();
    if (!total) {
      setErr("请填写后续章节总概要");
      return;
    }
    setBusy(true);
    setErr("");
    setBatchStreaming("");
    try {
      await flushSave();
      if (novelIdRef.current !== nid) return;
      const created = await generateChapterBatch(
        nid,
        {
          chapter_count: batchChapterCount,
          total_summary: total,
          after_chapter_id: activeId,
        },
        {
          onToken: (t) => {
            if (novelIdRef.current === nid) setBatchStreaming((prev) => prev + t);
          },
        }
      );
      if (novelIdRef.current !== nid) return;
      const full = await loadChapters();
      if (novelIdRef.current !== nid) return;
      setChapters(full);
      if (created.length > 0) {
        setActiveId(created[0].id);
      }
      setGenerateTab("single");
      setBatchStreaming((prev) => prev + `已完成，共生成 ${created.length} 章。`);
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
    const savedBody = content;
    try {
      let acc = "";
      const ch = await reviseChapter(
        nid,
        activeId,
        rewriteInstr.trim(),
        preferredLlm,
        "rewrite",
        (t) => {
          acc += t;
          if (novelIdRef.current === nid) setContent(acc);
        }
      );
      if (novelIdRef.current !== nid) return;
      const full = await loadChapters();
      if (novelIdRef.current !== nid) return;
      setChapters(full);
      setContent(normalizeBodyParagraphIndent(ch.content));
      setSummary(ch.summary);
      setRewriteInstr("");
    } catch (e) {
      if (novelIdRef.current === nid) {
        setErr(apiErrorMessage(e));
        setContent(savedBody);
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
    const savedAppendBody = content;
    try {
      const before = savedAppendBody.trimEnd();
      let addition = "";
      const ch = await reviseChapter(
        nid,
        activeId,
        appendInstr.trim(),
        preferredLlm,
        "append",
        (t) => {
          addition += t;
          if (novelIdRef.current === nid) {
            setContent(before + (addition ? "\n\n" + addition : ""));
          }
        }
      );
      if (novelIdRef.current !== nid) return;
      const full = await loadChapters();
      if (novelIdRef.current !== nid) return;
      setChapters(full);
      setContent(normalizeBodyParagraphIndent(ch.content));
      setSummary(ch.summary);
      setAppendInstr("");
    } catch (e) {
      if (novelIdRef.current === nid) {
        setErr(apiErrorMessage(e));
        setContent(savedAppendBody);
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
      setNamingResult("");
      const { text } = await novelAiNaming(
        id,
        {
          category: namingCategory,
          description: d,
          hint: namingHint || null,
        },
        (t) => setNamingResult((prev) => prev + t)
      );
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
    const prior = askHistory.map((m) => ({ role: m.role, content: m.content }));
    setAskHistory((h) => [...h, { role: "user", content: q }, { role: "assistant", content: "" }]);
    let acc = "";
    try {
      await novelAiChat(
        id,
        {
          message: q,
          history: prior,
        },
        (t) => {
          acc += t;
          setAskHistory((h) => {
            const copy = [...h];
            const last = copy[copy.length - 1];
            if (last?.role === "assistant") {
              copy[copy.length - 1] = { role: "assistant", content: acc };
            }
            return copy;
          });
        }
      );
    } catch (e) {
      setErr(apiErrorMessage(e));
      setAskHistory((h) => {
        if (h.length < 2) return h;
        const copy = [...h];
        copy.pop();
        copy.pop();
        return copy;
      });
      setAskInput(q);
    } finally {
      setBusy(false);
    }
  }

  async function onRunEvaluate() {
    const aid = activeId;
    if (aid === null) return;
    if (!(content || "").trim()) {
      setErr("请先撰写正文后再评估");
      return;
    }
    setEvaluateBusy(true);
    setErr("");
    setEvaluateResult(null);
    try {
      const data = await evaluateChapter(
        id,
        aid,
        {
          title,
          summary,
          content,
          llm_provider: preferredLlm,
        }
      );
      setEvaluateResult(data);
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setEvaluateBusy(false);
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
          <div className="write-sidenav-tools" ref={sidebarToolsRef}>
            <div className="write-font-picker">
              <button
                type="button"
                className="write-icon-btn write-font-btn"
                title="正文字体"
                aria-expanded={fontMenuOpen}
                aria-haspopup="listbox"
                aria-label="正文字体"
                onClick={() => {
                  setSizeMenuOpen(false);
                  setFontMenuOpen((v) => !v);
                }}
              >
                Aa
              </button>
              {fontMenuOpen ? (
                <ul className="write-font-menu" role="listbox" aria-label="选择正文字体">
                  {WRITE_BODY_FONTS.map((f) => (
                    <li key={f.id} role="presentation">
                      <button
                        type="button"
                        role="option"
                        aria-selected={bodyFontId === f.id}
                        className={`write-font-option${bodyFontId === f.id ? " is-active" : ""}`}
                        style={{ fontFamily: WRITE_FONT_PREVIEW[f.id] }}
                        onClick={() => {
                          setBodyFontId(f.id);
                          setFontMenuOpen(false);
                        }}
                      >
                        {f.label}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="write-size-picker">
              <button
                type="button"
                className="write-icon-btn write-size-menu-btn"
                title="正文字号"
                aria-expanded={sizeMenuOpen}
                aria-haspopup="dialog"
                aria-label="正文字号"
                onClick={() => {
                  setFontMenuOpen(false);
                  setSizeMenuOpen((v) => !v);
                }}
              >
                <span className="write-size-icon" aria-hidden>
                  <span className="write-size-icon-lg">A</span>
                  <span className="write-size-icon-sm">a</span>
                </span>
              </button>
              {sizeMenuOpen ? (
                <div className="write-size-popover" role="dialog" aria-label="调整正文字号">
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
                          WRITE_BODY_FONT_SIZES.find((x) => x.id === bodyFontSizeId)?.label ?? "标准"
                        }
                        onChange={(e) => {
                          const i = Number(e.target.value);
                          const row = WRITE_BODY_FONT_SIZES[i];
                          if (row) setBodyFontSizeId(row.id);
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
          </div>
        </div>

        <aside className={`write-left-sidebar${sidebarOpen ? " is-open" : ""}`}>
          <div className="write-left-inner card">
            <div className="write-left-head">
              <strong>章节</strong>
              <button type="button" className="btn btn-ghost" style={{ fontSize: "0.85rem" }} onClick={(e) => { e.stopPropagation(); void onAddChapter(); }}>
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
                      onClick={(e) => { e.stopPropagation(); void selectChapter(c.id); }}
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
                  placeholder="标题"
                />
                <div className="field write-body-field">
                  <textarea
                    ref={bodyTextareaRef}
                    className={`textarea editor-body editor-body--${bodyFontId}`}
                    style={{ fontSize: `${bodyFontSizePx}px` }}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    onKeyDown={handleBodyKeyDown}
                    onMouseUp={syncSelectionFromTextarea}
                    onSelect={syncSelectionFromTextarea}
                    onKeyUp={syncSelectionFromTextarea}
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
              {rightTool === "evaluate" && "AI 评估"}
            </span>
            <button type="button" className="write-ai-close btn btn-ghost" onClick={() => setRightTool(null)}>
              关闭
            </button>
          </div>
          <div className="write-ai-drawer-body">
            {rightTool === "generate" && activeId ? (
              <div className="write-ai-section">
                <div className="write-generate-tabs" role="tablist" aria-label="生成模式">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={generateTab === "single"}
                    className={`write-generate-tab${generateTab === "single" ? " is-active" : ""}`}
                    onClick={() => setGenerateTab("single")}
                  >
                    单章生成
                  </button>
                  {isLatestChapter ? (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={generateTab === "batch"}
                      className={`write-generate-tab${generateTab === "batch" ? " is-active" : ""}`}
                      onClick={() => setGenerateTab("batch")}
                    >
                      批量生成
                    </button>
                  ) : null}
                </div>

                {generateTab === "single" ? (
                  <>
                    <p className="hint">为当前章节生成正文</p>
                    <div className="field">
                      <div className="write-ai-field-label">
                        <label htmlFor="write-ai-chapter-summary">本章概要</label>
                        <button
                          type="button"
                          className={`write-summary-inspire-btn${showSingleInspireCta ? " write-summary-inspire-btn--with-text" : ""}`}
                          title="根据本书设定与已有章节，生成本章概要灵感"
                          aria-label="概要灵感"
                          disabled={!hasLlm || summaryInspireBusy}
                          onClick={() => void onSummaryInspire()}
                        >
                          {summaryInspireBusy ? (
                            <span className="write-summary-inspire-btn__busy" aria-hidden />
                          ) : (
                            <svg
                              className="write-summary-inspire-btn__icon"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.75"
                              aria-hidden
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M9.663 17h4.673M12 3v1m6.364 6.364l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                              />
                            </svg>
                          )}
                          {showSingleInspireCta ? <span>生成本章灵感</span> : null}
                        </button>
                      </div>
                      <textarea
                        id="write-ai-chapter-summary"
                        className="textarea"
                        rows={5}
                        value={summary}
                        onChange={(e) => setSummary(e.target.value)}
                        placeholder="本章要写的情节与要点…"
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="write-ai-generate-title">生成标题（可选）</label>
                      <input
                        id="write-ai-generate-title"
                        className="input"
                        value={singleGenerateTitle}
                        onChange={(e) => setSingleGenerateTitle(e.target.value)}
                        placeholder="留空则由 AI 根据新内容重新拟题"
                      />
                    </div>
                    <label className="write-generate-lock">
                      <input
                        type="checkbox"
                        checked={singleGenerateLockTitle}
                        onChange={(e) => setSingleGenerateLockTitle(e.target.checked)}
                      />
                      <span>固定使用上方标题，不让 AI 改题</span>
                    </label>
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={onGenerate}>
                      {busy ? "生成中…" : hasBody ? "重新生成并覆盖" : "生成"}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="hint">连续生成多章</p>
                    <div className="field">
                      <label htmlFor="write-ai-batch-count">生成章节数</label>
                      <input
                        id="write-ai-batch-count"
                        className="input"
                        type="text"
                        inputMode="numeric"
                        value={batchChapterCountInput}
                        onChange={(e) => {
                          const next = e.target.value.replace(/[^\d]/g, "");
                          setBatchChapterCountInput(next);
                        }}
                        onBlur={() => {
                          const next = parseBatchChapterCountInput(batchChapterCountInput);
                          setBatchChapterCountInput(String(next ?? 3));
                        }}
                      />
                    </div>
                    {!isLatestChapter ? (
                      <p className="muted" style={{ margin: "-0.2rem 0 0.85rem", fontSize: "0.84rem" }}>
                        为避免影响既有章节顺序，批量生成仅在最新章节可用。
                      </p>
                    ) : null}
                    <div className="field">
                      <div className="write-ai-field-label">
                        <label htmlFor="write-ai-batch-summary">后续总概要</label>
                        <button
                          type="button"
                          className={`write-summary-inspire-btn${showBatchInspireCta ? " write-summary-inspire-btn--with-text" : ""}`}
                          title="根据本书设定、已有章节，生成后续数章的总体剧情灵感"
                          aria-label="批量概要灵感"
                          disabled={!hasLlm || batchSummaryInspireBusy}
                          onClick={() => void onBatchSummaryInspire()}
                        >
                          {batchSummaryInspireBusy ? (
                            <span className="write-summary-inspire-btn__busy" aria-hidden />
                          ) : (
                            <svg
                              className="write-summary-inspire-btn__icon"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.75"
                              aria-hidden
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M9.663 17h4.673M12 3v1m6.364 6.364l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                              />
                            </svg>
                          )}
                          {showBatchInspireCta ? <span>生成后续灵感</span> : null}
                        </button>
                      </div>
                      <textarea
                        id="write-ai-batch-summary"
                        className="textarea"
                        rows={7}
                        value={batchSummary}
                        onChange={(e) => setBatchSummary(e.target.value)}
                        placeholder="描述接下来几章的大体主线、冲突推进与阶段目标…"
                      />
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy || !isLatestChapter}
                      onClick={onBatchGenerate}
                    >
                      {busy ? "批量生成中…" : `批量生成 ${batchChapterCount ?? 0} 章`}
                    </button>
                    {batchStreaming ? (
                      <pre className="write-generate-log">{batchStreaming}</pre>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}

            {rightTool === "rewrite" && activeId ? (
              <div className="write-ai-section">
                <p className="hint">说明希望如何修改正文，将本章内容替换为模型输出。</p>
                <textarea
                  className="textarea"
                  rows={5}
                  value={rewriteInstr}
                  onChange={(e) => setRewriteInstr(e.target.value)}
                  placeholder="例如：加强对话节奏、删去重复描写…"
                />
                <button type="button" className="btn btn-primary" disabled={busy} onClick={onRunRewrite}>
                  {busy ? "处理中…" : "改写"}
                </button>
              </div>
            ) : null}

            {rightTool === "append" && activeId ? (
              <div className="write-ai-section">
                <p className="hint">说明要在文末追加的内容。</p>
                <textarea
                  className="textarea"
                  rows={5}
                  value={appendInstr}
                  onChange={(e) => setAppendInstr(e.target.value)}
                  placeholder="例如：接一段回忆、补一场对话…"
                />
                <button type="button" className="btn btn-primary" disabled={busy} onClick={onRunAppend}>
                  {busy ? "处理中…" : "追加"}
                </button>
              </div>
            ) : null}

            {rightTool === "naming" ? (
              <div className="write-ai-section">
                <p className="hint">为人物、物品、功法等请求备选名称。</p>
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

            {rightTool === "evaluate" && activeId ? (
              <div className="write-ai-section">
                <p className="hint">
                AI评估本章内容
                </p>
                <p className="muted" style={{ margin: "0.25rem 0 0.75rem", fontSize: "0.82rem" }}>
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={evaluateBusy || busy}
                  onClick={() => void onRunEvaluate()}
                >
                  {evaluateBusy ? "评估中…" : "评估本章"}
                </button>
                {evaluateResult ? (
                  <div className="write-eval-block" style={{ marginTop: "1rem" }}>
                    <div className="write-eval-score" aria-label="去 AI 化分数">
                      <span className="write-eval-score-num">{evaluateResult.de_ai_score}</span>
                      <span className="write-eval-score-denom">/ 100</span>
                      <span className="muted write-eval-score-label">分数越高表示越接近自然人类创作</span>
                    </div>
                    {evaluateResult.issues.length === 0 ? (
                      <p className="muted" style={{ margin: "0.75rem 0 0", fontSize: "0.9rem" }}>
                        未发现明显问题（或正文过短）。你可改写后再试。
                      </p>
                    ) : (
                      <ul className="write-eval-issues stack-sm" style={{ margin: "0.75rem 0 0", paddingLeft: "1.1rem" }}>
                        {evaluateResult.issues.map((it, i) => (
                          <li key={i} style={{ fontSize: "0.9rem" }}>
                            <strong>{it.aspect}</strong>
                            <span className="muted"> — </span>
                            {it.detail}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
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

      {showSelectionBar && selectionMenuPos ? (
        <div
          className="write-selection-float"
          role="toolbar"
          aria-label="选中文本 AI"
          style={{ top: selectionMenuPos.top, left: selectionMenuPos.left }}
        >
          <button
            type="button"
            className="write-selection-float__item"
            disabled={busy}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void runSelectionAi("expand")}
          >
            <svg className="write-selection-float__icon" viewBox="0 0 24 24" aria-hidden>
              <path
                fill="currentColor"
                d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
              />
            </svg>
            扩写
          </button>
          <button
            type="button"
            className="write-selection-float__item"
            disabled={busy}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void runSelectionAi("polish")}
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
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
              />
            </svg>
            润色
          </button>
        </div>
      ) : null}

      {selectionPanel ? (
        <div
          className="write-selection-overlay"
          role="presentation"
          onClick={closeSelectionPanel}
        >
          <div
            className="write-selection-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="write-selection-card-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="write-selection-card-title" className="write-selection-card__title">
              {selectionPanel.mode === "expand" ? "AI 扩写" : "AI 润色"}
            </h2>
            <div className="write-selection-card__body">
              {selectionPanel.streaming || (busy ? "生成中…" : "")}
            </div>
            <p className="write-selection-card__disclaimer">
              内容由 AI 生成，仅供参考；请自行核对后使用。
            </p>
            <div className="write-selection-card__actions">
              <button
                type="button"
                className="btn btn-primary write-selection-card__replace"
                disabled={busy || !selectionPanel.text.trim()}
                onClick={applySelectionReplace}
              >
                替换
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy || !selectionPanel.text.trim()}
                onClick={() => void copySelectionResult()}
              >
                复制
              </button>
              <button type="button" className="btn btn-ghost" onClick={closeSelectionPanel}>
                退出
              </button>
              <div className="write-selection-card__actions-right">
                <button
                  type="button"
                  className="write-selection-icon-btn"
                  title="重新生成"
                  aria-label="重新生成"
                  disabled={busy}
                  onClick={() =>
                    void runSelectionAi(selectionPanel.mode, {
                      start: selectionPanel.start,
                      end: selectionPanel.end,
                    })
                  }
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
      ) : null}
    </div>
  );
}
