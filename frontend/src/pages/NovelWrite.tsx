import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  apiErrorMessage,
  compareVersionWithCurrent,
  confirmChapterGeneration,
  createChapter,
  createSingleBackgroundTask,
  createBatchBackgroundTask,
  deleteChapter,
  chapterSelectionAi,
  evaluateChapter,
  fetchChapterVersions,
  fetchChapters,
  fetchLlmProviders,
  generateChapter,
  generateChapterBatch,
  novelAiChapterSummaryInspire,
  novelAiNaming,
  reviseChapter,
  rollbackChapterToVersion,
  updateChapter,
  type ChapterPreviewResult,
  type ProgressEvent,
} from "@/api/client";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/i18n";
import type { Chapter, ChapterVersion, ChapterVersionDiff } from "@/types";
import { normalizeBodyParagraphIndent } from "@/utils/bodyParagraphIndent";
import { getCaretViewportPoint } from "@/utils/textareaCaretViewport";

type AiTool = "generate" | "rewrite" | "append" | "naming" | "evaluate" | "versions";

type GenerateTab = "single" | "batch";

const RAIL_ITEM_KEYS: { key: AiTool; labelKey: string }[] = [
  { key: "generate", labelKey: "write_tool_generate" },
  { key: "rewrite", labelKey: "write_tool_rewrite" },
  { key: "append", labelKey: "write_tool_append" },
  { key: "naming", labelKey: "write_tool_naming" },
  { key: "evaluate", labelKey: "write_tool_evaluate" },
  { key: "versions", labelKey: "write_tool_versions" },
];

type LineHeightId = "compact" | "normal" | "relaxed" | "loose";

const LINE_HEIGHT_IDS: LineHeightId[] = ["compact", "normal", "relaxed", "loose"];

const LINE_HEIGHT_VALUES: Record<LineHeightId, number> = {
  compact: 1.6,
  normal: 1.85,
  relaxed: 2.0,
  loose: 2.2,
};

const LINE_HEIGHT_LABEL_KEYS: Record<LineHeightId, string> = {
  compact: "write_line_height_compact",
  normal: "write_line_height_normal",
  relaxed: "write_line_height_relaxed",
  loose: "write_line_height_loose",
};

const WRITE_LINE_HEIGHT_KEY = "inkmind_write_line_height";

type LineWidthId = "md" | "lg" | "full";

const LINE_WIDTH_IDS: LineWidthId[] = ["md", "lg", "full"];

const LINE_WIDTH_MAX_WIDTHS: Record<LineWidthId, string | null> = {
  md: "55ch",
  lg: "68ch",
  full: null,
};

const LINE_WIDTH_LABEL_KEYS: Record<LineWidthId, string> = {
  md: "write_line_width_md",
  lg: "write_line_width_lg",
  full: "write_line_width_full",
};

const WRITE_LINE_WIDTH_KEY = "inkmind_write_line_width";

const WRITE_FOCUS_MODE_KEY = "inkmind_write_focus_mode";

function readStoredLineHeight(): LineHeightId {
  try {
    const v = localStorage.getItem(WRITE_LINE_HEIGHT_KEY);
    if (v && LINE_HEIGHT_IDS.includes(v as LineHeightId)) {
      return v as LineHeightId;
    }
  } catch {
    /* ignore */
  }
  return "normal";
}

const LEGACY_LINE_WIDTH_MAP: Record<string, LineWidthId> = {
  narrow: "md",
  medium: "md",
  wide: "lg",
  full: "full",
  xs: "md",
  sm: "md",
  lg: "lg",
  xl: "lg",
  "2xl": "lg",
};

function readStoredLineWidth(): LineWidthId {
  try {
    const v = localStorage.getItem(WRITE_LINE_WIDTH_KEY);
    if (v) {
      if (LINE_WIDTH_IDS.includes(v as LineWidthId)) {
        return v as LineWidthId;
      }
      const mapped = LEGACY_LINE_WIDTH_MAP[v];
      if (mapped) {
        localStorage.setItem(WRITE_LINE_WIDTH_KEY, mapped);
        return mapped;
      }
    }
  } catch {
    /* ignore */
  }
  return "full";
}

function readStoredFocusMode(): boolean {
  try {
    const v = localStorage.getItem(WRITE_FOCUS_MODE_KEY);
    return v === "true";
  } catch {
    return false;
  }
}

/** Font size tiers (internal mapping only) */
type WriteBodyFontSizeId = "xs" | "sm" | "md" | "lg" | "xl" | "xxl";

const WRITE_BODY_FONT_SIZE_IDS: WriteBodyFontSizeId[] = ["xs", "sm", "md", "lg", "xl", "xxl"];

const WRITE_BODY_FONT_SIZE_PX: Record<WriteBodyFontSizeId, number> = {
  xs: 14,
  sm: 16,
  md: 17,
  lg: 19,
  xl: 21,
  xxl: 24,
};

const WRITE_BODY_FONT_SIZE_LABEL_KEYS: Record<WriteBodyFontSizeId, string> = {
  xs: "write_font_size_xs",
  sm: "write_font_size_sm",
  md: "write_font_size_md",
  lg: "write_font_size_lg",
  xl: "write_font_size_xl",
  xxl: "write_font_size_xxl",
};

const WRITE_BODY_FONT_SIZE_KEY = "inkmind_write_body_font_size";
const LEGACY_BODY_FONT_SIZE_PX_KEY = "inkmind_write_body_font_size_px";

function nearestFontSizeId(px: number): WriteBodyFontSizeId {
  let best = WRITE_BODY_FONT_SIZE_IDS[0];
  let d = Math.abs(px - WRITE_BODY_FONT_SIZE_PX[best]);
  for (const id of WRITE_BODY_FONT_SIZE_IDS) {
    const dd = Math.abs(px - WRITE_BODY_FONT_SIZE_PX[id]);
    if (dd < d) {
      d = dd;
      best = id;
    }
  }
  return best;
}

function readStoredBodyFontSizeId(): WriteBodyFontSizeId {
  try {
    const v = localStorage.getItem(WRITE_BODY_FONT_SIZE_KEY);
    if (v && WRITE_BODY_FONT_SIZE_IDS.includes(v as WriteBodyFontSizeId)) {
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
  const nav = useNavigate();
  const { user } = useAuth();
  const { theme } = useTheme();
  const { t } = useI18n();

  const RAIL_ITEMS = useMemo(
    () => RAIL_ITEM_KEYS.map(({ key, labelKey }) => ({ key, line2: t(labelKey) })),
    [t]
  );

  const LINE_HEIGHTS = useMemo(
    () => LINE_HEIGHT_IDS.map((id) => ({ id, label: t(LINE_HEIGHT_LABEL_KEYS[id]), value: LINE_HEIGHT_VALUES[id] })),
    [t]
  );

  const LINE_WIDTHS = useMemo(
    () => LINE_WIDTH_IDS.map((id) => ({ id, label: t(LINE_WIDTH_LABEL_KEYS[id]), maxWidth: LINE_WIDTH_MAX_WIDTHS[id] })),
    [t]
  );

  const WRITE_BODY_FONT_SIZES = useMemo(
    () => WRITE_BODY_FONT_SIZE_IDS.map((id) => ({ id, label: t(WRITE_BODY_FONT_SIZE_LABEL_KEYS[id]), px: WRITE_BODY_FONT_SIZE_PX[id] })),
    [t]
  );
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
  const [bodyFontSizeId, setBodyFontSizeId] = useState<WriteBodyFontSizeId>(() =>
    typeof window !== "undefined" ? readStoredBodyFontSizeId() : "md"
  );
  const [lineHeightId, setLineHeightId] = useState<LineHeightId>(() =>
    typeof window !== "undefined" ? readStoredLineHeight() : "normal"
  );
  const [lineWidthId, setLineWidthId] = useState<LineWidthId>(() =>
    typeof window !== "undefined" ? readStoredLineWidth() : "full"
  );
  const [focusMode, setFocusMode] = useState(() =>
    typeof window !== "undefined" ? readStoredFocusMode() : false
  );
  const [sizeMenuOpen, setSizeMenuOpen] = useState(false);
  const [lineHeightMenuOpen, setLineHeightMenuOpen] = useState(false);
  const [lineWidthMenuOpen, setLineWidthMenuOpen] = useState(false);
  const sidebarToolsRef = useRef<HTMLDivElement | null>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [rewriteInstr, setRewriteInstr] = useState("");
  const [appendInstr, setAppendInstr] = useState("");
  const [namingCategory, setNamingCategory] = useState<"character" | "item" | "skill" | "other">("character");
  const [namingDesc, setNamingDesc] = useState("");
  const [namingHint, setNamingHint] = useState("");
  const [namingResult, setNamingResult] = useState<string[]>([]);
  const [namingSelectedIndex, setNamingSelectedIndex] = useState<number | null>(null);
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
  const [generateMode, setGenerateMode] = useState<"foreground" | "background">("foreground");
  const [singleGenerateTitle, setSingleGenerateTitle] = useState("");
  const [singleGenerateLockTitle, setSingleGenerateLockTitle] = useState(false);
  const [generateWordCount, setGenerateWordCount] = useState<number | null>(null);
  const [batchChapterCountInput, setBatchChapterCountInput] = useState("3");
  const [batchSummary, setBatchSummary] = useState("");
  const [batchStreaming, setBatchStreaming] = useState("");
  const [currentProgress, setCurrentProgress] = useState<ProgressEvent | null>(null);
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

  const [previewResult, setPreviewResult] = useState<ChapterPreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [isPreviewMode, setIsPreviewMode] = useState(false);

  const [versions, setVersions] = useState<ChapterVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<ChapterVersion | null>(null);
  const [versionDiff, setVersionDiff] = useState<ChapterVersionDiff | null>(null);
  const [versionDiffLoading, setVersionDiffLoading] = useState(false);
  const [versionActionLoading, setVersionActionLoading] = useState(false);
  const activeIdRef = useRef<number | null>(null);
  activeIdRef.current = activeId;
  const novelIdRef = useRef(id);
  novelIdRef.current = id;
  const lastLoadedChapterIdRef = useRef<number | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorSnapshotRef = useRef({ title: "", summary: "", content: "" });
  editorSnapshotRef.current = { title, summary, content };
  const preGenerateSnapshotRef = useRef({ title: "", summary: "", content: "" });

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
  const currentBodyFontSize = WRITE_BODY_FONT_SIZES[bodyFontSizeIndex] ?? WRITE_BODY_FONT_SIZES[2];

  const wordCount = content.replace(/\s/g, "").length;
  const charCount = content.length;
  const paragraphCount = content.split("\n").filter((p) => p.trim()).length;

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 900);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ".") {
        e.preventDefault();
        setFocusMode((prev) => !prev);
      }
      if (e.key === "Escape" && focusMode) {
        setFocusMode(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusMode]);

  const hasUnsavedChanges = useMemo(() => {
    if (activeId === null) return false;
    const snap = chapters.find((c) => c.id === activeId);
    if (!snap) return false;
    return snap.title !== title || snap.summary !== summary || snap.content !== content;
  }, [activeId, chapters, title, summary, content]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    try {
      localStorage.setItem(WRITE_BODY_FONT_SIZE_KEY, bodyFontSizeId);
    } catch {
      /* ignore */
    }
  }, [bodyFontSizeId]);

  useEffect(() => {
    try {
      localStorage.setItem(WRITE_LINE_HEIGHT_KEY, lineHeightId);
    } catch {
      /* ignore */
    }
  }, [lineHeightId]);

  useEffect(() => {
    try {
      localStorage.setItem(WRITE_LINE_WIDTH_KEY, lineWidthId);
    } catch {
      /* ignore */
    }
  }, [lineWidthId]);

  useEffect(() => {
    try {
      localStorage.setItem(WRITE_FOCUS_MODE_KEY, String(focusMode));
    } catch {
      /* ignore */
    }
    if (focusMode) {
      setSidebarOpen(false);
      setRightTool(null);
    }
  }, [focusMode]);

  useEffect(() => {
    if (!sizeMenuOpen && !lineHeightMenuOpen && !lineWidthMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (sidebarToolsRef.current && !sidebarToolsRef.current.contains(e.target as Node)) {
        setSizeMenuOpen(false);
        setLineHeightMenuOpen(false);
        setLineWidthMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSizeMenuOpen(false);
        setLineHeightMenuOpen(false);
        setLineWidthMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [sizeMenuOpen, lineHeightMenuOpen, lineWidthMenuOpen]);

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
      setErr(t("write_err_select_text"));
      return;
    }
    if (!hasLlm) {
      setErr(t("write_err_no_llm"));
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
      setErr(t("write_err_copy_failed"));
    }
  }

  async function loadVersions() {
    if (activeId === null) return;
    setVersionsLoading(true);
    setErr("");
    try {
      const list = await fetchChapterVersions(id, activeId);
      setVersions(list);
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setVersionsLoading(false);
    }
  }

  async function compareSelectedVersionWithCurrent(versionId: number) {
    if (activeId === null) return;
    setVersionDiffLoading(true);
    setErr("");
    try {
      const diff = await compareVersionWithCurrent(id, activeId, versionId);
      setVersionDiff(diff);
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setVersionDiffLoading(false);
    }
  }

  async function handleRollback(versionId: number, saveCurrent: boolean = true) {
    if (activeId === null) return;
    const confirmMsg = saveCurrent
      ? t("write_confirm_rollback_save")
      : t("write_confirm_rollback_discard");
    if (!window.confirm(confirmMsg)) return;
    
    setVersionActionLoading(true);
    setErr("");
    try {
      const ch = await rollbackChapterToVersion(id, activeId, versionId, saveCurrent);
      setTitle(ch.title);
      setSummary(ch.summary);
      setContent(normalizeBodyParagraphIndent(ch.content));
      setChapters((prev) => prev.map((x) => (x.id === ch.id ? ch : x)));
      setSelectedVersion(null);
      setVersionDiff(null);
      await loadVersions();
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setVersionActionLoading(false);
    }
  }

  function clearVersionState() {
    setVersions([]);
    setSelectedVersion(null);
    setVersionDiff(null);
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
  }, [showSelectionBar, selectionRange, content, bodyFontSizePx]);

  function needsChapter(tool: AiTool): boolean {
    return tool === "generate" || tool === "rewrite" || tool === "append" || tool === "evaluate" || tool === "versions";
  }

  function canOpenTool(tool: AiTool): boolean {
    if (tool === "versions") {
      return activeId !== null;
    }
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
    clearVersionState();
    if (narrow) setSidebarOpen(false);
  }

  useEffect(() => {
    if (rightTool === "versions" && activeId !== null) {
      loadVersions();
    }
  }, [rightTool, activeId]);

  useEffect(() => {
    if (activeId === null) return;
    if (isPreviewMode) return;
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
          const ch = await updateChapter(id, scheduledForId, {
            title,
            summary,
            content,
            skip_version: true,
          } as Parameters<typeof updateChapter>[2]);
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
  }, [title, summary, content, activeId, id, chapters, isPreviewMode]);

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
    if (!window.confirm(t("write_confirm_delete_chapter"))) return;
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
      setErr(t("write_err_batch_latest_only"));
      return;
    }
    if (!batchChapterCount) {
      setErr(t("write_err_chapter_count_range"));
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
      setErr(t("write_err_summary_required"));
      return;
    }
    if (!activeId) return;
    if (hasBody) {
      const ok = window.confirm(t("write_confirm_regenerate"));
      if (!ok) return;
    }
    preGenerateSnapshotRef.current = { title, summary, content };
    const savedContent = content;
    const savedTitle = title;
    setBusy(true);
    setErr("");
    setContent("");
    setPreviewResult(null);
    setIsPreviewMode(false);
    setCurrentProgress(null);
    try {
      const result = await generateChapter(nid, s, {
        chapterId: activeId,
        title: singleGenerateTitle.trim() || null,
        lockTitle: singleGenerateLockTitle,
        wordCount: generateWordCount,
        onToken: (t) => {
          if (novelIdRef.current === nid) setContent((p) => p + t);
        },
        onProgress: (progress) => {
          if (novelIdRef.current === nid) setCurrentProgress(progress);
        },
      });
      if (novelIdRef.current !== nid) return;

      if (result.preview) {
        setIsPreviewMode(true);
        setPreviewResult(result.preview);
        setTitle(result.preview.title);
        setContent(normalizeBodyParagraphIndent(result.preview.content));
        setSummary(result.preview.summary);
        if (result.preview.evaluate_result) {
          setEvaluateResult(result.preview.evaluate_result);
        }
      } else if (result.chapter) {
        const ch = result.chapter;
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
        setGenerateWordCount(null);
      } else {
        throw new Error(t("write_err_no_result"));
      }
    } catch (e) {
      if (novelIdRef.current === nid) {
        setErr(apiErrorMessage(e));
        setTitle(savedTitle);
        setContent(savedContent);
      }
    } finally {
      setBusy(false);
      setCurrentProgress(null);
    }
  }

  async function onConfirmPreview() {
    if (!previewResult || !activeId) return;
    const nid = id;
    setPreviewLoading(true);
    setErr("");
    try {
      const ch = await confirmChapterGeneration(nid, {
        chapter_id: activeId,
        title: previewResult.title,
        content: previewResult.content,
        summary: previewResult.summary,
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
      setPreviewResult(null);
      setIsPreviewMode(false);
      setSingleGenerateTitle("");
      setSingleGenerateLockTitle(false);
      setGenerateWordCount(null);
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setPreviewLoading(false);
    }
  }

  function onCancelPreview() {
    const { title: savedTitle, summary: savedSummary, content: savedContent } = preGenerateSnapshotRef.current;
    setPreviewResult(null);
    setEvaluateResult(null);
    setIsPreviewMode(false);
    setTitle(savedTitle);
    setSummary(savedSummary);
    setContent(savedContent);
  }

  async function onBatchGenerate() {
    const nid = id;
    if (!activeId) return;
    if (!isLatestChapter) {
      setErr(t("write_err_batch_latest_only"));
      return;
    }
    if (!batchChapterCount) {
      setErr(t("write_err_chapter_count_range"));
      return;
    }
    const total = batchSummary.trim();
    if (!total) {
      setErr(t("write_err_total_summary_required"));
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
          word_count: generateWordCount,
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
      setGenerateWordCount(null);
      setBatchStreaming((prev) => prev + `${t("write_batch_complete")} ${created.length} ${t("write_batch_chapters")}`);
    } catch (e) {
      if (novelIdRef.current === nid) {
        setErr(apiErrorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  }

  async function onGenerateBackground() {
    const nid = id;
    const s = summary.trim();
    if (!s) {
      setErr(t("write_err_summary_required"));
      return;
    }
    if (!activeId) return;
    
    setBusy(true);
    setErr("");
    try {
      await createSingleBackgroundTask({
        novel_id: nid,
        chapter_id: activeId,
        title: singleGenerateTitle.trim() || null,
        summary: s,
        fixed_title: singleGenerateLockTitle ? (singleGenerateTitle.trim() || null) : null,
        word_count: generateWordCount,
        task_type: hasBody ? "rewrite_chapter" : "single_chapter",
      });
      
      nav("/tasks");
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onBatchGenerateBackground() {
    const nid = id;
    if (!activeId) return;
    if (!isLatestChapter) {
      setErr(t("write_err_batch_latest_only"));
      return;
    }
    if (!batchChapterCount) {
      setErr(t("write_err_chapter_count_range"));
      return;
    }
    const total = batchSummary.trim();
    if (!total) {
      setErr(t("write_err_total_summary_required"));
      return;
    }
    
    setBusy(true);
    setErr("");
    try {
      await flushSave();
      if (novelIdRef.current !== nid) return;
      
      await createBatchBackgroundTask({
        novel_id: nid,
        after_chapter_id: activeId,
        total_summary: total,
        chapter_count: batchChapterCount,
        word_count: generateWordCount,
      });
      
      nav("/tasks");
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
      setErr(t("write_err_rewrite_instr_required"));
      return;
    }
    if (!hasBody) {
      setErr(t("write_err_rewrite_needs_body"));
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
      setErr(t("write_err_append_instr_required"));
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
      setErr(t("write_err_naming_desc_required"));
      return;
    }
    setBusy(true);
    setErr("");
    setNamingSelectedIndex(null);
    try {
      setNamingResult([]);
      let fullText = "";
      const { text } = await novelAiNaming(
        id,
        {
          category: namingCategory,
          description: d,
          hint: namingHint || null,
        },
        (chunk) => {
          fullText += chunk;
          const names = fullText
            .split("\n")
            .map((n) => n.trim())
            .filter((n) => n);
          setNamingResult(names);
        }
      );
      const finalNames = text
        .split("\n")
        .map((n) => n.trim())
        .filter((n) => n);
      setNamingResult(finalNames);
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onRunEvaluate() {
    const aid = activeId;
    if (aid === null) return;
    if (!(content || "").trim()) {
      setErr(t("write_err_evaluate_needs_body"));
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
    return <p className="muted">{t("write_loading_chapters")}</p>;
  }

  const drawerOpen =
    rightTool && hasLlm && (activeId !== null || rightTool === "naming");

  return (
    <div className={`write-shell write-theme--${theme}${focusMode ? " write-focus-mode" : ""}`}>
      {err ? <p className="form-error write-err-banner">{err}</p> : null}

      {narrow && sidebarOpen && !focusMode ? (
        <button
          type="button"
          className="write-sidebar-backdrop"
          aria-label={t("write_close_chapter_list")}
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <div className={`write-workspace${sidebarOpen ? " write-workspace--sidebar-open" : ""}`}>
        <div className="write-sidenav-toggle">
          <button
            type="button"
            className="write-icon-btn"
            title={sidebarOpen ? t("write_close_sidebar") : t("write_open_sidebar")}
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
            <div className="write-size-picker">
              <button
                type="button"
                className="write-icon-btn write-size-menu-btn"
                title={t("write_font_size")}
                aria-expanded={sizeMenuOpen}
                aria-haspopup="dialog"
                aria-label={t("write_font_size")}
                onClick={() => {
                  setLineHeightMenuOpen(false);
                  setLineWidthMenuOpen(false);
                  setSizeMenuOpen((v) => !v);
                }}
              >
                <span className="write-size-icon" aria-hidden>
                  <span className="write-size-icon-lg">A</span>
                  <span className="write-size-icon-sm">a</span>
                  <span className="write-size-icon-rule" />
                </span>
              </button>
              {sizeMenuOpen ? (
                <div className="write-size-popover" role="dialog" aria-label={t("write_adjust_font_size")}>
                  <div className="write-size-popover-head">
                    <span>{t("write_font_size")}</span>
                    <strong>{currentBodyFontSize.label} · {currentBodyFontSize.px}px</strong>
                  </div>
                  <div className="write-size-preview" style={{ fontSize: `${currentBodyFontSize.px}px` }}>
                    Aa
                  </div>
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
                          WRITE_BODY_FONT_SIZES.find((x) => x.id === bodyFontSizeId)?.label ?? t("write_font_size_md")
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

            <div className="write-line-height-picker">
              <button
                type="button"
                className="write-icon-btn write-line-height-btn"
                title={t("write_line_height")}
                aria-expanded={lineHeightMenuOpen}
                aria-haspopup="listbox"
                aria-label={t("write_line_height")}
                onClick={() => {
                  setSizeMenuOpen(false);
                  setLineWidthMenuOpen(false);
                  setLineHeightMenuOpen((v) => !v);
                }}
              >
                <span className="write-line-height-icon" aria-hidden>
                  <span className="write-line-height-line" />
                  <span className="write-line-height-line" />
                  <span className="write-line-height-line" />
                </span>
              </button>
              {lineHeightMenuOpen ? (
                <ul className="write-line-height-menu" role="listbox" aria-label={t("write_select_line_height")}>
                  {LINE_HEIGHTS.map((lh) => (
                    <li key={lh.id} role="presentation">
                      <button
                        type="button"
                        role="option"
                        aria-selected={lineHeightId === lh.id}
                        className={`write-line-height-option${lineHeightId === lh.id ? " is-active" : ""}`}
                        onClick={() => {
                          setLineHeightId(lh.id);
                          setLineHeightMenuOpen(false);
                        }}
                      >
                        {lh.label}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="write-line-width-picker">
              <button
                type="button"
                className="write-icon-btn write-line-width-btn"
                title={t("write_line_width")}
                aria-expanded={lineWidthMenuOpen}
                aria-haspopup="listbox"
                aria-label={t("write_line_width")}
                onClick={() => {
                  setSizeMenuOpen(false);
                  setLineHeightMenuOpen(false);
                  setLineWidthMenuOpen((v) => !v);
                }}
              >
                <span className="write-line-width-icon" aria-hidden>
                  <span className="write-line-width-bar write-line-width-bar--short" />
                  <span className="write-line-width-bar write-line-width-bar--medium" />
                  <span className="write-line-width-bar write-line-width-bar--long" />
                </span>
              </button>
              {lineWidthMenuOpen ? (
                <ul className="write-line-width-menu" role="listbox" aria-label={t("write_select_line_width")}>
                  {LINE_WIDTHS.map((lw) => (
                    <li key={lw.id} role="presentation">
                      <button
                        type="button"
                        role="option"
                        aria-selected={lineWidthId === lw.id}
                        className={`write-line-width-option${lineWidthId === lw.id ? " is-active" : ""}`}
                        onClick={() => {
                          setLineWidthId(lw.id);
                          setLineWidthMenuOpen(false);
                        }}
                      >
                        {lw.label}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <button
              type="button"
              className={`write-icon-btn write-focus-btn${focusMode ? " is-active" : ""}`}
              title={focusMode ? t("write_exit_focus_mode_shortcut") : t("write_focus_mode_shortcut")}
              aria-label={t("write_focus_mode")}
              onClick={() => setFocusMode((v) => !v)}
            >
              <span className="write-focus-icon" aria-hidden>
                <span />
                <span />
                <span />
                <span />
              </span>
            </button>
          </div>
        </div>

        <aside className={`write-left-sidebar${sidebarOpen ? " is-open" : ""}`}>
          <div className="write-left-inner card">
            <div className="write-left-head">
              <strong>{t("write_chapters")}</strong>
              <button type="button" className="btn btn-ghost" style={{ fontSize: "0.85rem" }} onClick={(e) => { e.stopPropagation(); void onAddChapter(); }}>
                {t("write_new_chapter")}
              </button>
            </div>
            <div className="chapter-list stack-sm">
              {chapters.length === 0 ? (
                <p className="muted" style={{ margin: 0, fontSize: "0.88rem" }}>
                  {t("write_no_chapters")}
                </p>
              ) : (
                chapters.map((c, idx) => (
                  <div key={c.id} className="chapter-row">
                    <button
                      type="button"
                      className={`chapter-item${c.id === activeId ? " active" : ""}`}
                      onClick={(e) => { e.stopPropagation(); void selectChapter(c.id); }}
                    >
                      {c.title?.trim() || `${t("write_chapter_n")} ${idx + 1}${t("write_chapter_n_suffix")}`}
                    </button>
                    <button
                      type="button"
                      className="chapter-del"
                      title={t("write_delete_chapter")}
                      aria-label={t("write_delete_chapter")}
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
                <div className="write-editor-header">
                  <input
                    className="editor-title editor-title--improved"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t("write_chapter_title_placeholder")}
                  />
                </div>
                <div className={`write-body-wrapper write-body-wrapper--${lineWidthId}`}>
                  <div className="field write-body-field">
                    <textarea
                      ref={bodyTextareaRef}
                      className={`textarea editor-body editor-body--line-height-${lineHeightId}`}
                      style={{ fontSize: `${bodyFontSizePx}px` }}
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      onKeyDown={handleBodyKeyDown}
                      onMouseUp={syncSelectionFromTextarea}
                      onSelect={syncSelectionFromTextarea}
                      onKeyUp={syncSelectionFromTextarea}
                      placeholder={t("write_start_writing")}
                    />
                  </div>
                </div>
                <div className="write-editor-footer">
                  <div className="write-word-stats">
                    <span className="write-word-stat-item">
                      <span className="write-word-stat-label">{t("write_stat_words")}</span>
                      <span className="write-word-stat-value">{wordCount}</span>
                    </span>
                    <span className="write-word-stat-item">
                      <span className="write-word-stat-label">{t("write_stat_chars")}</span>
                      <span className="write-word-stat-value">{charCount}</span>
                    </span>
                    <span className="write-word-stat-item">
                      <span className="write-word-stat-label">{t("write_stat_paragraphs")}</span>
                      <span className="write-word-stat-value">{paragraphCount}</span>
                    </span>
                  </div>
                  {focusMode ? (
                    <button
                      type="button"
                      className="btn btn-ghost write-exit-focus-btn"
                      onClick={() => setFocusMode(false)}
                    >
                      {t("write_exit_focus_mode_esc")}
                    </button>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="muted write-empty-hint" style={{ margin: 0 }}>
                {focusMode ? t("write_select_or_create_chapter") : t("write_select_chapter_or_new")}
              </p>
            )}
          </div>
        </div>
      </div>

      {!focusMode && (
        <nav className="write-ai-rail" aria-label={t("write_ai_features")}>
          {RAIL_ITEMS.map(({ key, line2 }) => (
            <button
              key={key}
              type="button"
              className={`write-rail-btn${rightTool === key ? " active" : ""}`}
              disabled={!canOpenTool(key)}
              title={
                !hasLlm
                  ? t("write_err_no_llm")
                  : needsChapter(key) && !activeId
                    ? t("write_please_select_chapter")
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
      )}

      {!focusMode && drawerOpen && rightTool && (
        <div className="write-ai-drawer">
          <div className="write-ai-drawer-head">
            <span>
              {rightTool === "generate" && t("write_ai_generate")}
              {rightTool === "rewrite" && t("write_ai_rewrite")}
              {rightTool === "append" && t("write_ai_append")}
              {rightTool === "naming" && t("write_ai_naming")}
              {rightTool === "evaluate" && t("write_ai_evaluate")}
              {rightTool === "versions" && t("write_version_versions")}
            </span>
            <button type="button" className="write-ai-close btn btn-ghost" onClick={() => setRightTool(null)}>
              {t("write_close")}
            </button>
          </div>
          <div className="write-ai-drawer-body">
            {rightTool === "generate" && activeId ? (
              <div className="write-ai-section">
                <div className="write-generate-tabs" role="tablist" aria-label={t("write_gen_mode")}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={generateTab === "single"}
                    className={`write-generate-tab${generateTab === "single" ? " is-active" : ""}`}
                    onClick={() => setGenerateTab("single")}
                  >
                    {t("write_single_chapter")}
                  </button>
                  {isLatestChapter ? (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={generateTab === "batch"}
                      className={`write-generate-tab${generateTab === "batch" ? " is-active" : ""}`}
                      onClick={() => setGenerateTab("batch")}
                    >
                      {t("write_batch_chapters")}
                    </button>
                  ) : null}
                </div>

                {generateTab === "single" ? (
                  <>
                    <p className="hint">{t("write_gen_for_current")}</p>
                    <div className="field">
                      <div className="write-ai-field-label">
                        <label htmlFor="write-ai-chapter-summary">{t("write_chapter_summary")}</label>
                        <button
                          type="button"
                          className={`write-summary-inspire-btn${showSingleInspireCta ? " write-summary-inspire-btn--with-text" : ""}`}
                          title={t("write_summary_inspire_tooltip")}
                          aria-label={t("write_summary_inspire_aria")}
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
                          {showSingleInspireCta ? <span>{t("write_generate_summary_inspire")}</span> : null}
                        </button>
                      </div>
                      <textarea
                        id="write-ai-chapter-summary"
                        className="textarea"
                        rows={5}
                        value={summary}
                        onChange={(e) => setSummary(e.target.value)}
                        placeholder={t("write_summary_placeholder")}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="write-ai-generate-title">{t("write_generate_title_optional")}</label>
                      <input
                        id="write-ai-generate-title"
                        className="input"
                        value={singleGenerateTitle}
                        onChange={(e) => setSingleGenerateTitle(e.target.value)}
                        placeholder={t("write_title_ai_decide")}
                      />
                    </div>
                    <label className="write-generate-lock">
                      <input
                        type="checkbox"
                        checked={singleGenerateLockTitle}
                        onChange={(e) => setSingleGenerateLockTitle(e.target.checked)}
                      />
                      <span>{t("write_lock_title_desc")}</span>
                    </label>
                    <div className="field">
                      <label htmlFor="write-ai-word-count">{t("write_target_word_count")}</label>
                      <select
                        id="write-ai-word-count"
                        className="select"
                        value={generateWordCount ?? ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          setGenerateWordCount(val ? parseInt(val, 10) : null);
                        }}
                      >
                        <option value="">{t("write_word_count_ai_decide")}</option>
                        <option value="500">500 {t("write_stat_words")}</option>
                        <option value="1000">1000 {t("write_stat_words")}</option>
                        <option value="1500">1500 {t("write_stat_words")}</option>
                        <option value="2000">2000 {t("write_stat_words")}</option>
                        <option value="2500">2500 {t("write_stat_words")}</option>
                        <option value="3000">3000 {t("write_stat_words")}</option>
                        <option value="3500">3500 {t("write_stat_words")}</option>
                        <option value="4000">4000 {t("write_stat_words")}</option>
                      </select>
                      <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.8rem" }}>
                        {t("write_word_count_approx")}
                      </p>
                    </div>
                    <div className="field" style={{ marginBottom: "1rem" }}>
                      <label>{t("write_generate_mode")}</label>
                      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
                        <button
                          type="button"
                          className={`btn ${generateMode === "foreground" ? "btn-primary" : "btn-ghost"}`}
                          onClick={() => setGenerateMode("foreground")}
                          style={{ flex: 1 }}
                        >
                          {t("write_foreground_realtime")}
                        </button>
                        <button
                          type="button"
                          className={`btn ${generateMode === "background" ? "btn-primary" : "btn-ghost"}`}
                          onClick={() => setGenerateMode("background")}
                          style={{ flex: 1 }}
                        >
                          {t("write_background_leave")}
                        </button>
                      </div>
                      {generateMode === "background" && (
                        <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.8rem" }}>
                          {t("write_background_desc")}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={generateMode === "background" ? () => void onGenerateBackground() : onGenerate}
                    >
                      {busy ? t("write_generating") : hasBody ? t("write_regenerate_overwrite") : generateMode === "background" ? t("write_submit_background") : t("write_generate")}
                    </button>

                    {generateMode === "foreground" && busy && currentProgress ? (
                      <pre className="write-generate-log" style={{ marginTop: "0.5rem" }}>
                        {currentProgress.message}
                        {currentProgress.detail && (
                          <span style={{ color: "var(--muted)", fontSize: "0.875rem", display: "block", marginTop: "0.25rem" }}>
                            {currentProgress.detail.length > 100 ? currentProgress.detail.slice(0, 100) + "..." : currentProgress.detail}
                          </span>
                        )}
                      </pre>
                    ) : null}

                    {previewResult ? (
                      <div className="stack-sm" style={{ marginTop: "1rem" }}>
                        <div
                          className={`card ${
                            previewResult.needs_revision ? "border-warning" : "border-success"
                          }`}
                          style={{ padding: "0.75rem", borderRadius: "0.5rem", borderLeft: "4px solid" }}
                        >
                          <p style={{ margin: 0, fontWeight: 500 }}>
                            {previewResult.needs_revision
                              ? t("write_preview_low_score")
                              : t("write_preview_ready")}
                          </p>
                          {previewResult.evaluate_result && (
                            <p style={{ margin: "0.25rem 0 0", fontSize: "0.875rem" }}>
                              {t("write_deai_score").replace("{score}", String(previewResult.evaluate_result.de_ai_score))}
                              {previewResult.evaluate_result.issues.length > 0 && (
                                <span>{t("write_issues_found").replace("{count}", String(previewResult.evaluate_result.issues.length))}</span>
                              )}
                            </p>
                          )}
                        </div>
                        <div className="write-preview-actions" style={{ display: "flex", gap: "0.5rem" }}>
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={previewLoading}
                            onClick={() => void onConfirmPreview()}
                          >
                            {previewLoading ? t("write_saving") : t("write_confirm_save")}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={previewLoading}
                            onClick={onCancelPreview}
                          >
                            {t("write_cancel")}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <p className="hint">{t("write_gen_multiple_chapters")}</p>
                    <div className="field">
                      <label htmlFor="write-ai-batch-count">{t("write_chapter_count")}</label>
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
                        {t("write_batch_latest_only_note")}
                      </p>
                    ) : null}
                    <div className="field">
                      <label htmlFor="write-ai-batch-word-count">{t("write_per_chapter_word_count")}</label>
                      <select
                        id="write-ai-batch-word-count"
                        className="select"
                        value={generateWordCount ?? ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          setGenerateWordCount(val ? parseInt(val, 10) : null);
                        }}
                      >
                        <option value="">{t("write_word_count_ai_decide")}</option>
                        <option value="500">500 {t("write_stat_words")}</option>
                        <option value="1000">1000 {t("write_stat_words")}</option>
                        <option value="1500">1500 {t("write_stat_words")}</option>
                        <option value="2000">2000 {t("write_stat_words")}</option>
                        <option value="2500">2500 {t("write_stat_words")}</option>
                        <option value="3000">3000 {t("write_stat_words")}</option>
                        <option value="3500">3500 {t("write_stat_words")}</option>
                        <option value="4000">4000 {t("write_stat_words")}</option>
                      </select>
                      <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.8rem" }}>
                        {t("write_word_count_approx")}
                      </p>
                    </div>
                    <div className="field">
                      <div className="write-ai-field-label">
                        <label htmlFor="write-ai-batch-summary">{t("write_overall_summary")}</label>
                        <button
                          type="button"
                          className={`write-summary-inspire-btn${showBatchInspireCta ? " write-summary-inspire-btn--with-text" : ""}`}
                          title={t("write_batch_summary_inspire_tooltip")}
                          aria-label={t("write_batch_summary_inspire_aria")}
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
                          {showBatchInspireCta ? <span>{t("write_generate_batch_inspire")}</span> : null}
                        </button>
                      </div>
                      <textarea
                        id="write-ai-batch-summary"
                        className="textarea"
                        rows={7}
                        value={batchSummary}
                        onChange={(e) => setBatchSummary(e.target.value)}
                        placeholder={t("write_batch_summary_placeholder")}
                      />
                    </div>
                    <div className="field" style={{ marginBottom: "1rem" }}>
                      <label>{t("write_generate_mode")}</label>
                      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
                        <button
                          type="button"
                          className={`btn ${generateMode === "foreground" ? "btn-primary" : "btn-ghost"}`}
                          onClick={() => setGenerateMode("foreground")}
                          style={{ flex: 1 }}
                        >
                          {t("write_foreground_realtime")}
                        </button>
                        <button
                          type="button"
                          className={`btn ${generateMode === "background" ? "btn-primary" : "btn-ghost"}`}
                          onClick={() => setGenerateMode("background")}
                          style={{ flex: 1 }}
                        >
                          {t("write_background_leave")}
                        </button>
                      </div>
                      {generateMode === "background" && (
                        <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.8rem" }}>
                          {t("write_background_batch_desc")}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy || !isLatestChapter}
                      onClick={generateMode === "background" ? () => void onBatchGenerateBackground() : onBatchGenerate}
                    >
                      {busy ? t("write_batch_generating") : generateMode === "background" ? t("write_submit_background") : `${t("write_batch_generate_n")} ${batchChapterCount ?? 0} ${t("write_batch_generate_n_suffix")}`}
                    </button>
                    {generateMode === "foreground" && batchStreaming ? (
                      <pre className="write-generate-log">{batchStreaming}</pre>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}

            {rightTool === "rewrite" && activeId ? (
              <div className="write-ai-section">
                <p className="hint">{t("write_rewrite_hint")}</p>
                <textarea
                  className="textarea"
                  rows={5}
                  value={rewriteInstr}
                  onChange={(e) => setRewriteInstr(e.target.value)}
                  placeholder={t("write_rewrite_placeholder")}
                />
                <button type="button" className="btn btn-primary" disabled={busy} onClick={onRunRewrite}>
                  {busy ? t("write_processing") : t("write_rewrite")}
                </button>
              </div>
            ) : null}

            {rightTool === "append" && activeId ? (
              <div className="write-ai-section">
                <p className="hint">{t("write_append_hint")}</p>
                <textarea
                  className="textarea"
                  rows={5}
                  value={appendInstr}
                  onChange={(e) => setAppendInstr(e.target.value)}
                  placeholder={t("write_append_placeholder")}
                />
                <button type="button" className="btn btn-primary" disabled={busy} onClick={onRunAppend}>
                  {busy ? t("write_processing") : t("write_append")}
                </button>
              </div>
            ) : null}

            {rightTool === "naming" ? (
              <div className="write-ai-section">
                <p className="hint">{t("write_naming_hint")}</p>
                <div className="field">
                  <label>{t("write_naming_category")}</label>
                  <select
                    className="input"
                    value={namingCategory}
                    onChange={(e) =>
                      setNamingCategory(e.target.value as typeof namingCategory)
                    }
                  >
                    <option value="character">{t("write_naming_cat_character")}</option>
                    <option value="item">{t("write_naming_cat_item")}</option>
                    <option value="skill">{t("write_naming_cat_skill")}</option>
                    <option value="other">{t("write_naming_cat_other")}</option>
                  </select>
                </div>
                <div className="field">
                  <label>{t("write_naming_object")}</label>
                  <textarea
                    className="textarea"
                    rows={3}
                    value={namingDesc}
                    onChange={(e) => setNamingDesc(e.target.value)}
                    placeholder={t("write_naming_object_placeholder")}
                  />
                </div>
                <div className="field">
                  <label>{t("write_naming_hint_label")}</label>
                  <textarea
                    className="textarea textarea-compact"
                    rows={2}
                    value={namingHint}
                    onChange={(e) => setNamingHint(e.target.value)}
                    placeholder={t("write_naming_hint_placeholder")}
                  />
                </div>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={onRunNaming}>
                  {busy ? t("write_generating") : t("write_naming_generate")}
                </button>
                {namingResult && namingResult.length > 0 ? (
                  <div className="write-naming-results stack-sm" style={{ marginTop: "1rem" }}>
                    {namingResult.map((name, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className={`write-naming-result-btn${namingSelectedIndex === idx ? " is-selected" : ""}`}
                        onClick={() => setNamingSelectedIndex(idx)}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {rightTool === "evaluate" && activeId ? (
              <div className="write-ai-section">
                <p className="hint">
                {t("write_evaluate_title")}
                </p>
                <p className="muted" style={{ margin: "0.25rem 0 0.75rem", fontSize: "0.82rem" }}>
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={evaluateBusy || busy}
                  onClick={() => void onRunEvaluate()}
                >
                  {evaluateBusy ? t("write_evaluating") : t("write_evaluate_chapter")}
                </button>
                {evaluateResult ? (
                  <div className="write-eval-block" style={{ marginTop: "1rem" }}>
                    <div className="write-eval-score" aria-label={t("write_deai_score_aria")}>
                      <span className="write-eval-score-num">{evaluateResult.de_ai_score}</span>
                      <span className="write-eval-score-denom">/ 100</span>
                      <span className="muted write-eval-score-label">{t("write_deai_score_desc")}</span>
                    </div>
                    {evaluateResult.issues.length === 0 ? (
                      <p className="muted" style={{ margin: "0.75rem 0 0", fontSize: "0.9rem" }}>
                        {t("write_evaluate_no_issues")}
                      </p>
                    ) : (
                      <ul className="write-eval-issues stack-sm" style={{ margin: "0.75rem 0 0", paddingLeft: "1.1rem" }}>
                        {evaluateResult.issues.map((it, i) => (
                          <li key={i} style={{ fontSize: "0.9rem" }}>
                            <strong>{it.aspect}</strong>
                            <span className="muted">{t("write_eval_issue_separator")}</span>
                            {it.detail}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

            {rightTool === "versions" && activeId ? (
              <div className="write-ai-section">
                <div style={{ marginBottom: "1rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                    <span className="muted" style={{ fontSize: "0.85rem" }}>
                      {t("write_version_count").replace("{count}", String(versions.length))}
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: "0.8rem", padding: "0.25rem 0.5rem" }}
                      disabled={versionsLoading}
                      onClick={() => loadVersions()}
                    >
                      {t("common_refresh")}
                    </button>
                  </div>
                  
                  {versionsLoading ? (
                    <p className="muted" style={{ textAlign: "center", padding: "1rem" }}>
                      {t("write_loading_versions")}
                    </p>
                  ) : versions.length === 0 ? (
                    <p className="muted" style={{ textAlign: "center", padding: "1rem" }}>
                      {t("write_no_versions")}
                    </p>
                  ) : (
                    <div style={{ maxHeight: "400px", overflowY: "auto" }}>
                      <div className="stack-sm">
                        {versions.map((v) => (
                          <div
                            key={v.id}
                            className={`card version-item${selectedVersion?.id === v.id ? " version-item--active" : ""}`}
                            style={{ padding: "0.75rem", cursor: "pointer" }}
                            onClick={() => {
                              setSelectedVersion(v);
                              setVersionDiff(null);
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                                  <strong style={{ fontSize: "0.9rem" }}>
                                    {t("write_version_n")} {v.version_number}
                                  </strong>
                                  <span
                                    className="version-type-badge"
                                    style={{
                                      fontSize: "0.7rem",
                                      padding: "0.125rem 0.375rem",
                                      borderRadius: "4px",
                                      backgroundColor: v.change_type.startsWith("ai") || v.change_type.startsWith("selection") ? "var(--info-bg)" : "var(--bg-hover)",
                                      color: v.change_type.startsWith("ai") || v.change_type.startsWith("selection") ? "var(--info)" : "var(--muted)",
                                    }}
                                  >
                                    {v.change_type === "manual" && t("write_change_manual")}
                                    {v.change_type === "ai_generate" && t("write_change_ai_gen")}
                                    {v.change_type === "ai_rewrite" && t("write_change_ai_rewrite")}
                                    {v.change_type === "ai_append" && t("write_change_ai_append")}
                                    {v.change_type === "selection_expand" && t("write_change_ai_expand")}
                                    {v.change_type === "selection_polish" && t("write_change_ai_polish")}
                                    {v.change_type === "rollback" && t("write_change_rollback")}
                                  </span>
                                </div>
                                {v.title && (
                                  <p style={{ margin: "0.25rem 0", fontSize: "0.85rem", color: "var(--muted)" }}>
                                    {t("write_version_title").replace("{title}", v.title.length > 30 ? v.title.slice(0, 30) + "…" : v.title)}
                                  </p>
                                )}
                                <p style={{ margin: "0.25rem 0", fontSize: "0.8rem", color: "var(--muted)" }}>
                                  {new Date(v.created_at).toLocaleString()}
                                </p>
                                <p style={{ margin: "0.25rem 0", fontSize: "0.75rem", color: "var(--muted)" }}>
                                  {t("write_version_word_count").replace("{count}", String(v.content.replace(/\s/g, "").length))}
                                </p>
                              </div>
                            </div>
                            
                            {selectedVersion?.id === v.id && (
                              <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border)" }}>
                                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
                                  <button
                                    type="button"
                                    className="btn btn-ghost"
                                    style={{ fontSize: "0.8rem", padding: "0.25rem 0.5rem" }}
                                    disabled={versionDiffLoading || versionActionLoading}
                                    onClick={() => compareSelectedVersionWithCurrent(v.id)}
                                  >
                                    {versionDiffLoading ? t("write_comparing") : t("write_compare_with_current")}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn"
                                    style={{ fontSize: "0.8rem", padding: "0.25rem 0.5rem" }}
                                    disabled={versionActionLoading}
                                    onClick={() => handleRollback(v.id, true)}
                                  >
                                    {t("write_rollback_save_current")}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-danger"
                                    style={{ fontSize: "0.8rem", padding: "0.25rem 0.5rem" }}
                                    disabled={versionActionLoading}
                                    onClick={() => handleRollback(v.id, false)}
                                  >
                                    {t("write_rollback_direct")}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {versionDiff && (
                    <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--border)" }}>
                      <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.95rem" }}>{t("write_version_diff_title")}</h4>
                      <div style={{ display: "flex", gap: "1rem", marginBottom: "0.75rem", fontSize: "0.8rem" }}>
                        <span style={{ color: "var(--success)" }}>{t("write_version_diff_added").replace("{count}", String(versionDiff.added_count))}</span>
                        <span style={{ color: "var(--error)" }}>{t("write_version_diff_removed").replace("{count}", String(versionDiff.removed_count))}</span>
                        <span style={{ color: "var(--warning)" }}>{t("write_version_diff_changed").replace("{count}", String(versionDiff.changed_count))}</span>
                      </div>
                      <div
                        className="version-diff-container"
                        style={{
                          maxHeight: "300px",
                          overflowY: "auto",
                          padding: "0.75rem",
                          backgroundColor: "var(--card)",
                          borderRadius: "4px",
                          fontFamily: "monospace",
                          fontSize: "0.8rem",
                          lineHeight: "1.5",
                        }}
                        dangerouslySetInnerHTML={{ __html: versionDiff.diff_html }}
                      />
                    </div>
                  )}
                  
                  {selectedVersion && !versionDiff && (
                    <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--border)" }}>
                      <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.95rem" }}>{t("write_version_preview_title")}</h4>
                      {selectedVersion.summary && (
                        <div style={{ marginBottom: "0.5rem" }}>
                          <strong style={{ fontSize: "0.85rem" }}>{t("write_version_summary")}</strong>
                          <p style={{ margin: "0.25rem 0", fontSize: "0.85rem", color: "var(--muted)" }}>
                            {selectedVersion.summary}
                          </p>
                        </div>
                      )}
                      <div>
                        <strong style={{ fontSize: "0.85rem" }}>{t("write_version_content")}</strong>
                        <pre
                          style={{
                            margin: "0.25rem 0",
                            padding: "0.75rem",
                            backgroundColor: "var(--card)",
                            borderRadius: "4px",
                            fontSize: "0.8rem",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            maxHeight: "200px",
                            overflowY: "auto",
                          }}
                        >
                          {selectedVersion.content}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

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
            onClick={() => void runSelectionAi("expand")}
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
            {t("write_selection_polish")}
          </button>
        </div>
      )}

      {selectionPanel && (
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
              {selectionPanel.mode === "expand" ? t("write_selection_expand_title") : t("write_selection_polish_title")}
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
                onClick={applySelectionReplace}
              >
                {t("write_selection_replace")}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy || !selectionPanel.text.trim()}
                onClick={() => void copySelectionResult()}
              >
                {t("write_selection_copy")}
              </button>
              <button type="button" className="btn btn-ghost" onClick={closeSelectionPanel}>
                {t("write_selection_exit")}
              </button>
              <div className="write-selection-card__actions-right">
                <button
                  type="button"
                  className="write-selection-icon-btn"
                  title={t("write_selection_regenerate")}
                  aria-label={t("write_selection_regenerate")}
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
      )}
    </div>
  );
}
