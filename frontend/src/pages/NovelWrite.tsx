import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useBlocker, useOutletContext, useSearchParams } from "react-router-dom";
import { Dropdown, Modal } from "antd";
import {
  ReadOutlined,
  MoreOutlined,
  CheckCircleOutlined,
  EditOutlined,
  ForwardOutlined,
  RobotOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  apiErrorMessage,
  compareVersionWithCurrent,
  confirmChapterGeneration,
  createChapter,
  createSingleBackgroundTask,
  createBatchBackgroundTask,
  deleteChapter,
  chapterSelectionAi,
  createMemo,
  evaluateChapter,
  fetchChapterVersions,
  fetchChapters,
  fetchLlmProviders,
  generateChapter,
  generateChapterBatch,
  novelAiChapterSummaryInspire,
  novelAiNaming,
  previewChapterRevision,
  rollbackChapterToVersion,
  updateChapter,
  type ChapterPreviewResult,
} from "@/api/client";
import { useAuth } from "@/context/AuthContext";
import { useNavigation } from "@/context/NavigationContext";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/i18n";
import type { Chapter, ChapterVersion, ChapterVersionDiff, LlmProvidersResponse, Novel } from "@/types";
import { normalizeBodyParagraphIndent } from "@/utils/bodyParagraphIndent";
import { getCaretViewportPoint } from "@/utils/textareaCaretViewport";
import EditorSettings, { useEditorSettings } from "@/components/write/EditorSettings";
import { useWritingLayout } from "@/components/write/useWritingLayout";
import WritingLayoutControls, { WritingPaneResizeHandle } from "@/components/write/WritingLayoutControls";
import "@/styles/writing-layout.css";
import ChapterSidebar from "@/components/write/ChapterSidebar";
import AiOperationPanel from "@/components/write/AiOperationPanel";
import { useAiOperation } from "@/components/write/useAiOperation";
import GenerationReview from "@/components/write/GenerationReview";
import ReferencePanel from "@/components/write/ReferencePanel";
import { llmSelection } from "@/utils/llmSelection";
import { isNovelSetupComplete } from "@/utils/novelSetup";
import { isDesktopApp } from "@/api/client";
import SelectionFloatMenu from "@/components/write/SelectionFloatMenu";
import type { AiTool, SelectionAiMode, GenerateTab } from "@/components/write/types";
import { draftKey, readDraft, readPosition, sameSnapshot, sessionKey, singleFlight, type WritingDraft, type WritingPosition } from "@/utils/writeSession";

function parseBatchChapterCountInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(20, Math.round(n)));
}

function estimateTextareaRows(value: string, charsPerLine = 62, minRows = 3, maxRows = 9): number {
  const rows = (value || "").split("\n").reduce((sum, line) => (
    sum + Math.max(1, Math.ceil((line.trim().length || 1) / charsPerLine))
  ), 0);
  return Math.max(minRows, Math.min(maxRows, rows));
}

export default function NovelWrite() {
  const { novelId } = useParams();
  const id = Number(novelId);
  const { novel } = useOutletContext<{ novel: Novel | null }>();
  const [searchParams] = useSearchParams();
  const requestedChapterId = Number(searchParams.get("chapter")) || null;
  const nav = useNavigate();
  const { user } = useAuth();
  const { registerLeaveGuard } = useNavigation();
  const { theme } = useTheme();
  const { t } = useI18n();
  const [modal, modalContextHolder] = Modal.useModal();
  const editorSettings = useEditorSettings();
  const { lineHeightId, lineWidthId, focusMode, setFocusMode, bodyFontSizePx, typewriterMode } = editorSettings;

  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [rightTool, setRightTool] = useState<AiTool | null>(null);
  const [commandPanelPos, setCommandPanelPos] = useState<{ left: number; top: number } | null>(null);
  const [commandPanelDragging, setCommandPanelDragging] = useState(false);
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 900 : false
  );
  const sidebarToolsRef = useRef<HTMLDivElement | null>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const commandPanelRef = useRef<HTMLDivElement | null>(null);
  const selectionPanelRef = useRef<HTMLDivElement | null>(null);
  const evaluatePanelRef = useRef<HTMLDivElement | null>(null);
  const commandPanelDragRef = useRef<{
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
    width: number;
    height: number;
  } | null>(null);

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
  const [evaluatePanelPos, setEvaluatePanelPos] = useState<{ left: number; top: number } | null>(null);
  const [evaluatePanelDragging, setEvaluatePanelDragging] = useState(false);
  const evaluatePanelDragRef = useRef<{
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
    width: number;
    height: number;
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [summaryInspireBusy, setSummaryInspireBusy] = useState(false);
  const [batchSummaryInspireBusy, setBatchSummaryInspireBusy] = useState(false);
  const [generateTab, setGenerateTab] = useState<GenerateTab>("single");
  const [generateMode, setGenerateMode] = useState<"foreground" | "background">("foreground");
  const [singleGenerateTitle, setSingleGenerateTitle] = useState("");
  const [singleGenerateLockTitle, setSingleGenerateLockTitle] = useState(false);
  const [batchChapterCountInput, setBatchChapterCountInput] = useState("3");
  const [batchSummary, setBatchSummary] = useState("");
  const [batchStreaming, setBatchStreaming] = useState("");
  const ai = useAiOperation(`${id}:${activeId}`);
  const [reviewedDraft, setReviewedDraft] = useState("");
  /** 正文选区：用于 AI 扩写/润色 */
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number } | null>(null);
  const [selectionPanel, setSelectionPanel] = useState<{
    mode: SelectionAiMode;
    start: number;
    end: number;
    text: string;
    streaming: string;
  } | null>(null);
  const [selectionMenuPos, setSelectionMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [selectionPanelPos, setSelectionPanelPos] = useState<{ left: number; top: number } | null>(null);
  const [selectionPanelDragging, setSelectionPanelDragging] = useState(false);
  const selectionPanelDragRef = useRef<{
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
    width: number;
    height: number;
  } | null>(null);
  const selectionRangeRef = useRef<{ start: number; end: number } | null>(null);
  const preserveSelectionForAssistantRef = useRef(false);
  selectionRangeRef.current = selectionRange;
  const [err, setErr] = useState("");

  type SaveStatus = "saved" | "saving" | "unsaved" | "error";
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [editorChapterId, setEditorChapterId] = useState<number | null>(null);
  const [recoveryDraft, setRecoveryDraft] = useState<WritingDraft | null>(null);
  const restorePositionRef = useRef<WritingPosition | null>(null);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [providerMeta, setProviderMeta] = useState<LlmProvidersResponse | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const [previewResult, setPreviewResult] = useState<ChapterPreviewResult | null>(null);
  const [reviewRejected, setReviewRejected] = useState<Set<number>>(new Set());
  const [reviewMetadata, setReviewMetadata] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [previewLeaveOpen, setPreviewLeaveOpen] = useState(false);
  const [previewLeaveBusy, setPreviewLeaveBusy] = useState(false);
  const previewLeaveResolverRef = useRef<((canLeave: boolean) => void) | null>(null);

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
  const chaptersRef = useRef<Chapter[]>([]);
  chaptersRef.current = chapters;
  const saveBlockedRef = useRef(false);
  const bodyStreamingRef = useRef(false);
  saveBlockedRef.current = isPreviewMode || Boolean(recoveryDraft);
  const createVersionRef = useRef(false);

  const layout = useWritingLayout({
    panelOpen: !focusMode && Boolean((rightTool && activeId !== null) || assistantOpen || referenceOpen || selectionPanel || (evaluateResult && ai.operation?.kind !== "evaluate")),
    focusMode,
    desktop: !narrow,
  });
  const { sidebarOpen, closeOverlay } = layout;
  const handleDrawerClose = useCallback(() => setRightTool(null), []);
  const handleOpenSmartWriterPrompt = useCallback((prompt: string) => {
    setRightTool(null);
    setReferenceOpen(false);
    window.dispatchEvent(new CustomEvent("inkmind:assistant-open", {
      detail: { novelId: id, prompt },
    }));
  }, [id]);
  const handleCommandPanelDragStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (rightTool === "versions" || window.innerWidth >= 900) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, textarea, input, select, a")) return;
    const rect = commandPanelRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    commandPanelDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      width: rect.width,
      height: rect.height,
    };
    setCommandPanelPos({ left: rect.left, top: rect.top });
    setCommandPanelDragging(true);
  }, [rightTool]);

  const handleSelectionPanelDragStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (window.innerWidth >= 900) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, textarea, input, select, a")) return;
    const rect = selectionPanelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const startLeft = selectionPanelPos?.left ?? selectionMenuPos?.left ?? rect.left + rect.width / 2;
    const startTop = selectionPanelPos?.top ?? (selectionMenuPos ? selectionMenuPos.top + 8 : rect.top);
    event.preventDefault();
    selectionPanelDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startLeft,
      startTop,
      width: rect.width,
      height: rect.height,
    };
    setSelectionPanelPos({ left: startLeft, top: startTop });
    setSelectionPanelDragging(true);
  }, [selectionMenuPos, selectionPanelPos]);

  const getEvaluatePanelDefaultPos = useCallback((): { left: number; top: number } => {
    const margin = 20;
    const panelWidth = Math.min(440, window.innerWidth - margin * 2);
    return {
      left: Math.max(margin, window.innerWidth - panelWidth - 34),
      top: Math.max(margin, Math.min(132, window.innerHeight - 360)),
    };
  }, []);

  const handleEvaluatePanelDragStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (window.innerWidth >= 900) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, textarea, input, select, a")) return;
    const rect = evaluatePanelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const startLeft = evaluatePanelPos?.left ?? rect.left;
    const startTop = evaluatePanelPos?.top ?? rect.top;
    event.preventDefault();
    evaluatePanelDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startLeft,
      startTop,
      width: rect.width,
      height: rect.height,
    };
    setEvaluatePanelPos({ left: startLeft, top: startTop });
    setEvaluatePanelDragging(true);
  }, [evaluatePanelPos]);

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

  const wordCount = Array.from(content.replace(/\s/g, "")).length;
  const wordCountText = t("write_version_word_count").replace("{count}", String(wordCount));
  const summaryRows = useMemo(() => estimateTextareaRows(summary, narrow ? 32 : 78, 3, 9), [summary, narrow]);

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 900);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!commandPanelDragging) return;

    const handleMove = (event: PointerEvent) => {
      const drag = commandPanelDragRef.current;
      if (!drag) return;
      const margin = 12;
      const maxLeft = Math.max(margin, window.innerWidth - drag.width - margin);
      const maxTop = Math.max(margin, window.innerHeight - drag.height - margin);
      setCommandPanelPos({
        left: Math.min(maxLeft, Math.max(margin, drag.startLeft + event.clientX - drag.startX)),
        top: Math.min(maxTop, Math.max(margin, drag.startTop + event.clientY - drag.startY)),
      });
    };
    const handleUp = () => {
      commandPanelDragRef.current = null;
      setCommandPanelDragging(false);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [commandPanelDragging]);

  useEffect(() => {
    if (!selectionPanelDragging) return;

    const handleMove = (event: PointerEvent) => {
      const drag = selectionPanelDragRef.current;
      if (!drag) return;
      const margin = 12;
      const halfWidth = drag.width / 2;
      const minLeft = margin + halfWidth;
      const maxLeft = Math.max(minLeft, window.innerWidth - halfWidth - margin);
      const maxTop = Math.max(margin, window.innerHeight - drag.height - margin);
      setSelectionPanelPos({
        left: Math.min(maxLeft, Math.max(minLeft, drag.startLeft + event.clientX - drag.startX)),
        top: Math.min(maxTop, Math.max(margin, drag.startTop + event.clientY - drag.startY)),
      });
    };
    const handleUp = () => {
      selectionPanelDragRef.current = null;
      setSelectionPanelDragging(false);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [selectionPanelDragging]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      const shouldPreserve = Boolean(target?.closest(".ai-assistant-panel, .ai-assistant-float-btn, .write-assistant-trigger"));
      preserveSelectionForAssistantRef.current = shouldPreserve;
      if (shouldPreserve && selectionRangeRef.current) {
        const preserved = selectionRangeRef.current;
        window.setTimeout(() => {
          bodyTextareaRef.current?.setSelectionRange(preserved.start, preserved.end);
        }, 0);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, []);

  useEffect(() => {
    if (!evaluatePanelDragging) return;

    const handleMove = (event: PointerEvent) => {
      const drag = evaluatePanelDragRef.current;
      if (!drag) return;
      const margin = 12;
      const maxLeft = Math.max(margin, window.innerWidth - drag.width - margin);
      const maxTop = Math.max(margin, window.innerHeight - drag.height - margin);
      setEvaluatePanelPos({
        left: Math.min(maxLeft, Math.max(margin, drag.startLeft + event.clientX - drag.startX)),
        top: Math.min(maxTop, Math.max(margin, drag.startTop + event.clientY - drag.startY)),
      });
    };
    const handleUp = () => {
      evaluatePanelDragRef.current = null;
      setEvaluatePanelDragging(false);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [evaluatePanelDragging]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ".") {
        e.preventDefault();
        setFocusMode((v) => !v);
      }
      if (e.key === "Escape" && focusMode) {
        setFocusMode(() => false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusMode, setFocusMode]);

  const hasUnsavedChanges = useMemo(() => {
    if (activeId === null) return false;
    const snap = chapters.find((c) => c.id === activeId);
    if (!snap) return false;
    return snap.title !== title || snap.summary !== summary || snap.content !== content;
  }, [activeId, chapters, title, summary, content]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges || isPreviewMode || busy || previewLoading) {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges, isPreviewMode, busy, previewLoading]);

  useEffect(() => {
    if (focusMode) {
      setRightTool(null);
      setReferenceOpen(false);
    }
  }, [focusMode]);

  useEffect(() => {
    document.body.classList.toggle("inkmind-writing-focus", focusMode);
    return () => document.body.classList.remove("inkmind-writing-focus");
  }, [focusMode]);

  useEffect(() => {
    const handler = (event: Event) => {
      const open = Boolean((event as CustomEvent<{ open: boolean }>).detail?.open);
      setAssistantOpen(open);
      if (open) { setRightTool(null); setReferenceOpen(false); }
    };
    window.addEventListener("inkmind:assistant-visibility", handler);
    return () => window.removeEventListener("inkmind:assistant-visibility", handler);
  }, []);

  useEffect(() => {
    if (rightTool) { setReferenceOpen(false); window.dispatchEvent(new Event("inkmind:assistant-minimize")); }
  }, [rightTool]);

  useEffect(() => {
    if (!rightTool || focusMode) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = commandPanelRef.current;
    panel?.querySelector<HTMLButtonElement>(".write-ai-close")?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && panel?.contains(document.activeElement)) {
        event.preventDefault(); setRightTool(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener?.isConnected && (panel?.contains(document.activeElement) || document.activeElement === document.body)) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [rightTool, focusMode]);

  useEffect(() => {
    if (typewriterMode !== "on") return;
    const ta = bodyTextareaRef.current;
    if (!ta) return;
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 24;
    const visibleHeight = ta.clientHeight;
    const cursorLine = ta.value.substring(0, ta.selectionEnd).split("\n").length;
    const targetScroll = cursorLine * lineHeight - visibleHeight / 2;
    ta.scrollTop = Math.max(0, targetScroll);
  }, [content, typewriterMode]);

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
    setEditorChapterId(null);
    setTitle("");
    setSummary("");
    setContent("");

    let cancelled = false;
    (async () => {
      try {
        const [list, meta] = await Promise.all([fetchChapters(id), fetchLlmProviders()]);
        if (cancelled || novelIdRef.current !== id) return;
        setChapters(list);
        setProviderMeta(meta);
        if (list.length > 0) {
          const previous = user ? readPosition(localStorage, sessionKey(user.id, id)) : null;
          setActiveId(list.find((chapter) => chapter.id === requestedChapterId)?.id ?? list.find((chapter) => chapter.id === previous?.chapterId)?.id ?? list[0].id);
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
  }, [id, user?.id, requestedChapterId]);

  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.id) {
        try {
          await flushSave();
        } catch (error) { setErr(apiErrorMessage(error)); return; }
        try {
          const full = await loadChapters();
          const target = full.find((c) => c.id === detail.id);
          if (target) {
            setActiveId(target.id);
            lastLoadedChapterIdRef.current = null;
            setTitle(target.title);
            setSummary(target.summary || "");
            setContent(normalizeBodyParagraphIndent(target.content || ""));
          }
          setChapters(full);
        } catch (error) { setErr(apiErrorMessage(error)); return; }
      }
    };
    window.addEventListener("inkmind:chapter-saved", handler);
    return () => window.removeEventListener("inkmind:chapter-saved", handler);
  }, [loadChapters]);

  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.id) {
        try {
          await flushSave();
        } catch { /* ignore */ }
        try {
          const full = await loadChapters();
          const deletedId = detail.id;
          if (activeId === deletedId) {
            const remaining = full.filter((c) => c.id !== deletedId);
            if (remaining.length > 0) {
              const next = remaining[0];
              setActiveId(next.id);
              lastLoadedChapterIdRef.current = null;
              setTitle(next.title);
              setSummary(next.summary || "");
              setContent(normalizeBodyParagraphIndent(next.content || ""));
            } else {
              setActiveId(null);
              lastLoadedChapterIdRef.current = null;
              setTitle("");
              setSummary("");
              setContent("");
            }
          }
          setChapters(full);
        } catch { /* ignore */ }
      }
    };
    window.addEventListener("inkmind:chapter-deleted", handler);
    return () => window.removeEventListener("inkmind:chapter-deleted", handler);
  }, [loadChapters, activeId]);

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
    setEvaluatePanelPos(null);
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
    setEvaluatePanelPos(null);
  }, [activeId]);

  useEffect(() => {
    if (!isLatestChapter && generateTab === "batch") {
      setGenerateTab("single");
    }
  }, [generateTab, isLatestChapter]);

  useEffect(() => {
    if (activeId === null) {
      lastLoadedChapterIdRef.current = null;
      setEditorChapterId(null);
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
    setEditorChapterId(activeId);
    setSaveStatus("saved");
    setTitle(ch.title);
    setSummary(ch.summary);
    setContent(normalizeBodyParagraphIndent(ch.content));
    if (user) {
      const key = draftKey(user.id, id, activeId);
      const draft = readDraft(localStorage, key);
      setRecoveryDraft(draft && !sameSnapshot(draft, ch) ? draft : null);
      restorePositionRef.current = readPosition(localStorage, sessionKey(user.id, id));
    }
  }, [activeId, chapters]);

  useLayoutEffect(() => {
    if (editorChapterId !== activeId || loading) return;
    const previous = restorePositionRef.current;
    const textarea = bodyTextareaRef.current;
    if (!textarea) return;
    if (previous?.chapterId === activeId) {
      textarea.setSelectionRange(Math.min(previous.start, textarea.value.length), Math.min(previous.end, textarea.value.length));
      textarea.scrollTop = previous.scrollTop;
    } else {
      textarea.setSelectionRange(0, 0);
      textarea.scrollTop = 0;
    }
    restorePositionRef.current = null;
  }, [editorChapterId, activeId, loading]);

  const rememberPosition = useCallback(() => {
    const textarea = bodyTextareaRef.current;
    if (!user || !textarea || !activeId || editorChapterId !== activeId) return;
    try {
      localStorage.setItem(sessionKey(user.id, id), JSON.stringify({
        chapterId: activeId, start: textarea.selectionStart, end: textarea.selectionEnd, scrollTop: textarea.scrollTop,
      }));
    } catch { /* Writing remains available when browser storage is full/disabled. */ }
  }, [user?.id, id, activeId, editorChapterId]);

  useEffect(() => { rememberPosition(); }, [rememberPosition]);

  useEffect(() => {
    if (!busy) return;
    if (selectionPanel) return;
    const el = bodyTextareaRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [content, busy, selectionPanel]);

  const hasBody = (content || "").trim().length > 0;
  const modelSelection = user && providerMeta ? llmSelection(user, providerMeta, isDesktopApp) : null;
  const hasLlm = Boolean(modelSelection?.generationProvider && modelSelection.generationModel);

  function canMutateChapter(): boolean {
    if (busy || previewLoading || versionActionLoading || saveBlockedRef.current || navigationPendingRef.current) {
      setErr(t(isPreviewMode ? "write_resolve_preview" : recoveryDraft ? "write_resolve_draft" : "write_wait_for_operation"));
      return false;
    }
    return true;
  }

  const confirmAction = useCallback((message: string) => (
    new Promise<boolean>((resolve) => {
      modal.confirm({
        title: t("common_confirm"),
        content: message,
        okText: t("common_confirm"),
        cancelText: t("common_cancel"),
        centered: true,
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    })
  ), [t, modal]);

  function captureSelection(): { start: number; end: number } | null {
    const ta = bodyTextareaRef.current;
    if (!ta) return null;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    if (s === e) return null;
    return { start: s, end: e };
  }

  function estimateSelectedLineCount(text: string): number {
    const ta = bodyTextareaRef.current;
    if (!ta || !text) return 0;
    const style = getComputedStyle(ta);
    const horizontalPadding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const fontSize = parseFloat(style.fontSize) || 16;
    const usableWidth = Math.max(160, ta.clientWidth - horizontalPadding);
    const charWidth = fontSize * 0.56;
    const charsPerLine = Math.max(18, Math.floor(usableWidth / charWidth));

    return text.split(/\r?\n/).reduce((total, line) => {
      const weightedLength = Array.from(line).reduce((sum, char) => (
        sum + (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(char) ? 1.7 : 1)
      ), 0);
      return total + Math.max(1, Math.ceil(weightedLength / charsPerLine));
    }, 0);
  }

  function syncSelectionFromTextarea() {
    const range = captureSelection();
    if (!range && preserveSelectionForAssistantRef.current && selectionRangeRef.current) {
      const preserved = selectionRangeRef.current;
      setSelectionRange(preserved);
      window.setTimeout(() => {
        bodyTextareaRef.current?.setSelectionRange(preserved.start, preserved.end);
      }, 0);
      return;
    }
    setSelectionRange(range);
    if (!range || activeId === null) {
      window.dispatchEvent(new CustomEvent("inkmind:editor-selection", {
        detail: { novelId: id, chapterId: activeId, text: "", lineCount: 0 },
      }));
      return;
    }
    const selectedText = content.slice(range.start, range.end);
    window.dispatchEvent(new CustomEvent("inkmind:editor-selection", {
      detail: {
        novelId: id,
        chapterId: activeId,
        chapterTitle: title,
        text: selectedText,
        lineCount: Math.max(1, estimateSelectedLineCount(selectedText)),
        start: range.start,
        end: range.end,
      },
    }));
  }

  function getSelectionResultAnchor(range: { start: number; end: number }): { left: number; top: number } | null {
    const ta = bodyTextareaRef.current;
    if (!ta || range.start === range.end) return null;
    const startPt = getCaretViewportPoint(ta, range.start);
    const endPt = getCaretViewportPoint(ta, range.end);
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 24;
    const viewportPadding = 16;
    const panelWidth = Math.min(440, window.innerWidth - viewportPadding * 2);
    const halfPanel = panelWidth / 2;
    const minLeft = viewportPadding + halfPanel;
    const maxLeft = Math.max(minLeft, window.innerWidth - halfPanel - viewportPadding);
    const maxTop = Math.max(viewportPadding, window.innerHeight - 260);
    const selectionCenter = (startPt.left + endPt.left) / 2;
    return {
      left: Math.min(maxLeft, Math.max(minLeft, selectionCenter)),
      top: Math.min(maxTop, Math.max(viewportPadding, Math.max(startPt.top, endPt.top) + lineHeight + 10)),
    };
  }

  useEffect(() => {
    if (!selectionPanel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeSelectionPanel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectionPanel]);

  async function runSelectionAi(
    mode: SelectionAiMode,
    rangeOverride?: { start: number; end: number }
  ) {
    if (!canMutateChapter()) return;
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
    setRightTool(null);
    window.dispatchEvent(new Event("inkmind:assistant-minimize"));
    setSelectionPanelPos(getSelectionResultAnchor(r));
    setSelectionPanel({ mode, start: r.start, end: r.end, text: "", streaming: "" });
    setBusy(true);
    const request = ai.begin("selection", t("write_selection_" + mode + "_title"), t("ai_stream_context"));
    try {
      await flushSave();
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
          ...request.options,
          onToken: (t) => {
            request.options.onToken?.(t);
            if (!request.isCurrent()) return;
            acc += t;
            setSelectionPanel((p) => (p ? { ...p, streaming: acc } : null));
          },
        }
      );
      if (!request.isCurrent()) return;
      setSelectionPanel((p) => (p ? { ...p, text, streaming: text } : null));
      request.complete(text);
    } catch (e) {
      request.fail(apiErrorMessage(e));
      if (request.isCurrent()) setErr(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function closeSelectionPanel() {
    if (ai.operation?.kind === "selection") { ai.cancel(); ai.dismiss(); }
    setSelectionPanel(null);
    setSelectionPanelPos(null);
  }

  function applySelectionReplace() {
    if (!canMutateChapter()) return;
    if (!selectionPanel || !selectionPanel.text.trim()) return;
    const { start, end, text } = selectionPanel;
    setContent((c) => {
      const insertion = selectionPanel.mode === "append"
        ? c.slice(0, end) + "\n\n" + text + c.slice(end)
        : c.slice(0, start) + text + c.slice(end);
      return normalizeBodyParagraphIndent(insertion);
    });
    setSelectionPanel(null);
    setSelectionPanelPos(null);
    setSelectionRange(null);
    setSelectionMenuPos(null);
  }

  async function addSelectionToMemo() {
    const r = selectionRange ?? captureSelection();
    if (!r || activeId === null) return;
    const selected = content.slice(r.start, r.end).trim();
    if (!selected) {
      setErr(t("write_err_select_text"));
      return;
    }
    try {
      await createMemo(id, {
        title: selected.slice(0, 24) || t("write_selection_memo_title"),
        body: selected,
      });
      setSelectionRange(null);
      setSelectionMenuPos(null);
    } catch (e) {
      setErr(apiErrorMessage(e));
    }
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
    if (!canMutateChapter()) return;
    if (activeId === null) return;
    const confirmMsg = saveCurrent
      ? t("write_confirm_rollback_save")
      : t("write_confirm_rollback_discard");
    if (!(await confirmAction(confirmMsg))) return;
    
    setVersionActionLoading(true);
    setErr("");
    try {
      await flushSave();
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
    if (!showSelectionBar && !selectionPanel) {
      setSelectionMenuPos(null);
      return;
    }
    if (!showSelectionBar) return;
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
      const viewportPadding = 16;
      const selectionCenter = (startPt.left + endPt.left) / 2;
      const anchorLeft = Math.min(
        window.innerWidth - viewportPadding,
        Math.max(viewportPadding, selectionCenter)
      );
      setSelectionMenuPos({ top: Math.max(viewportPadding, anchorTop - 10), left: anchorLeft });
    };
    update();
    ta.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      ta.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [showSelectionBar, selectionRange, content, bodyFontSizePx]);

  const drainSave = useMemo(() => singleFlight(async () => {
    const aid = activeIdRef.current;
    if (aid === null || saveBlockedRef.current || bodyStreamingRef.current) return;
    try {
      while (activeIdRef.current === aid && novelIdRef.current === id && !saveBlockedRef.current && !bodyStreamingRef.current) {
        const snapshot = { ...editorSnapshotRef.current };
        const before = chaptersRef.current.find((chapter) => chapter.id === aid);
        if (!before || sameSnapshot(before, snapshot)) break;
        setSaveStatus("saving");
        const skipVersion = !createVersionRef.current;
        createVersionRef.current = false;
        const chapter = await updateChapter(id, aid, { ...snapshot, skip_version: skipVersion } as Parameters<typeof updateChapter>[2]);
        if (novelIdRef.current !== id) return;
        // Update the baseline immediately, before React renders the response.
        chaptersRef.current = chaptersRef.current.map((item) => item.id === aid ? chapter : item);
        setChapters(chaptersRef.current);
        if (user && sameSnapshot(editorSnapshotRef.current, snapshot)) {
          try { localStorage.removeItem(draftKey(user.id, id, aid)); } catch { /* ignore */ }
        }
      }
      setSaveStatus("saved");
      createVersionRef.current = false;
    } catch (error) {
      setSaveStatus("error");
      throw error;
    }
  }), [id, user?.id]);

  const flushSave = useCallback(async (createVersion = true): Promise<void> => {
    createVersionRef.current ||= createVersion;
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    await drainSave();
  }, [drainSave]);

  const onConfirmPreview = useCallback(async (): Promise<boolean> => {
    if (!previewResult || !activeId) return false;
    const nid = id;
    setPreviewLoading(true);
    setErr("");
    try {
      const ch = await confirmChapterGeneration(nid, {
        chapter_id: activeId,
        title: reviewMetadata ? previewResult.title : title,
        content: reviewedDraft,
        summary: reviewMetadata ? previewResult.summary : summary,
      });
      if (novelIdRef.current !== nid) return false;
      const full = await loadChapters();
      if (novelIdRef.current !== nid) return false;
      setChapters(full);
      setActiveId(ch.id);
      lastLoadedChapterIdRef.current = null;
      setTitle(ch.title);
      setSummary(ch.summary);
      setContent(normalizeBodyParagraphIndent(ch.content));
      ai.dismiss();
      setPreviewResult(null);
      setIsPreviewMode(false);
      setSingleGenerateTitle("");
      setSingleGenerateLockTitle(false);
      return true;
    } catch (e) {
      setErr(apiErrorMessage(e));
      return false;
    } finally {
      setPreviewLoading(false);
    }
  }, [activeId, ai, id, loadChapters, previewResult, reviewMetadata, reviewedDraft, summary, title]);

  const onCancelPreview = useCallback(() => {
    ai.dismiss();
    setErr("");
    const { title: savedTitle, summary: savedSummary, content: savedContent } = preGenerateSnapshotRef.current;
    setPreviewResult(null);
    setEvaluateResult(null);
    setIsPreviewMode(false);
    setTitle(savedTitle);
    setSummary(savedSummary);
    setContent(savedContent);
  }, [ai]);

  const finishPreviewLeave = useCallback((canLeave: boolean) => {
    setPreviewLeaveOpen(false);
    const resolve = previewLeaveResolverRef.current;
    previewLeaveResolverRef.current = null;
    resolve?.(canLeave);
  }, []);

  const promptPreviewLeave = useCallback(() => new Promise<boolean>((resolve) => {
    previewLeaveResolverRef.current?.(false);
    previewLeaveResolverRef.current = resolve;
    setPreviewLeaveOpen(true);
  }), []);

  useEffect(() => () => {
    previewLeaveResolverRef.current?.(false);
    previewLeaveResolverRef.current = null;
  }, []);

  const handleAcceptPreviewAndLeave = useCallback(async () => {
    setPreviewLeaveBusy(true);
    const saved = await onConfirmPreview();
    setPreviewLeaveBusy(false);
    finishPreviewLeave(saved);
  }, [finishPreviewLeave, onConfirmPreview]);

  const handleDiscardPreviewAndLeave = useCallback(() => {
    onCancelPreview();
    finishPreviewLeave(true);
  }, [finishPreviewLeave, onCancelPreview]);

  const beforeLeave = useCallback(async () => {
    rememberPosition();
    if (busy || previewLoading || versionActionLoading) {
      setErr(t("write_wait_for_operation"));
      return false;
    }
    if (recoveryDraft) {
      setErr(t("write_resolve_draft"));
      return false;
    }
    if (isPreviewMode) return promptPreviewLeave();
    try {
      await flushSave();
      return true;
    } catch (error) {
      setErr(`${t("write_save_failed")} ${apiErrorMessage(error)}`);
      return false;
    }
  }, [rememberPosition, busy, previewLoading, versionActionLoading, recoveryDraft, isPreviewMode, promptPreviewLeave, flushSave, t]);

  useEffect(() => registerLeaveGuard(beforeLeave), [registerLeaveGuard, beforeLeave]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search) &&
    (hasUnsavedChanges || isPreviewMode || saveStatus === "saving" || busy || previewLoading || versionActionLoading || Boolean(recoveryDraft))
  );
  const navigationPendingRef = useRef(false);
  useEffect(() => {
    if (blocker.state !== "blocked" || navigationPendingRef.current) return;
    navigationPendingRef.current = true;
    void beforeLeave().then((canLeave) => {
      if (canLeave) blocker.proceed();
      else blocker.reset();
    }).finally(() => { navigationPendingRef.current = false; });
  }, [blocker, beforeLeave]);

  const selectChapter = useCallback(async (cid: number) => {
    if (cid === activeIdRef.current) return;
    setErr("");
    if (!(await beforeLeave())) return;
    setActiveId(cid);
    clearVersionState();
    closeOverlay();
  }, [beforeLeave, closeOverlay]);

  const activeIndex = chapters.findIndex((c) => c.id === activeId);
  const hasPrevChapter = activeIndex > 0;
  const hasNextChapter = activeIndex >= 0 && activeIndex < chapters.length - 1;

  const goToPrevChapter = useCallback(() => {
    if (activeIndex > 0) selectChapter(chapters[activeIndex - 1].id);
  }, [activeIndex, chapters, selectChapter]);

  const goToNextChapter = useCallback(() => {
    if (activeIndex >= 0 && activeIndex < chapters.length - 1) selectChapter(chapters[activeIndex + 1].id);
  }, [activeIndex, chapters, selectChapter]);

  useEffect(() => {
    if (rightTool === "versions" && activeId !== null) {
      loadVersions();
    }
  }, [rightTool, activeId]);

  useEffect(() => {
    if (activeId === null || editorChapterId !== activeId) return;
    if (isPreviewMode || busy || previewLoading || versionActionLoading || recoveryDraft) return;
    const snap = chapters.find((c) => c.id === activeId);
    if (!snap) return;
    if (snap.title === title && snap.summary === summary && snap.content === content) {
      setSaveStatus("saved");
      return;
    }
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    setSaveStatus((status) => status === "saving" ? status : "unsaved");
    if (user) {
      try {
        localStorage.setItem(draftKey(user.id, id, activeId), JSON.stringify({
          title, summary, content, chapterId: activeId, savedAt: Date.now(),
        } satisfies WritingDraft));
      } catch { /* Server saving and unload protection still work without local storage. */ }
    }
    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      void flushSave(false).catch((error) => setErr(apiErrorMessage(error)));
    }, 850);
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [title, summary, content, activeId, editorChapterId, id, chapters, isPreviewMode, busy, previewLoading, versionActionLoading, recoveryDraft, flushSave, user?.id]);

  function toggleVersionsPanel() {
    if (activeId === null) return;
    setRightTool((prev) => (prev === "versions" ? null : "versions"));
    setErr("");
  }

  function handleBodyKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.currentTarget.readOnly) return;
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

  const onAddChapter = useCallback(async () => {
    const nid = id;
    setErr("");
    try {
      if (!(await beforeLeave())) return;
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
      closeOverlay();
    } catch (e) {
      if (novelIdRef.current === nid) {
        setErr(apiErrorMessage(e));
      }
    }
  }, [id, beforeLeave, loadChapters]);

  const onDeleteChapterById = useCallback(async (cid: number) => {
    const nid = id;
    if (!(await confirmAction(t("write_confirm_delete_chapter")))) return;
    setErr("");
    try {
      if (!(await beforeLeave())) return;
      if (novelIdRef.current !== nid) return;
      await deleteChapter(nid, cid);
      if (user) {
        try { localStorage.removeItem(draftKey(user.id, nid, cid)); } catch { /* ignore */ }
      }
      if (novelIdRef.current !== nid) return;
      const full = await loadChapters();
      if (novelIdRef.current !== nid) return;
      setChapters(full);
      lastLoadedChapterIdRef.current = null;
      if (cid === activeIdRef.current) {
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
  }, [id, t, confirmAction, beforeLeave, loadChapters, user?.id]);

  async function onSummaryInspire() {
    if (!canMutateChapter()) return;
    const nid = id;
    if (!activeId || !hasLlm) return;
    setSummaryInspireBusy(true);
    setErr("");
    setBusy(true);
    if (narrow) setRightTool(null);
    const request = ai.begin("summary", t("write_chapter_summary"), t("ai_stream_context"));
    try {
      const result = await novelAiChapterSummaryInspire(
        nid, { chapter_id: activeId, chapter_count: 1 }, request.options.onToken, request.options
      );
      if (!request.isCurrent()) return;
      setSummary(result.summary); request.complete(result.summary);
    } catch (e) {
      if (novelIdRef.current === nid) {
        request.fail(apiErrorMessage(e));
        if (request.isCurrent()) setErr(apiErrorMessage(e));
      }
    } finally {
      setSummaryInspireBusy(false);
      setBusy(false);
    }
  }

  async function onBatchSummaryInspire() {
    if (!canMutateChapter()) return;
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
    setBusy(true);
    if (narrow) setRightTool(null);
    const request = ai.begin("summary", t("write_chapter_summary"), t("ai_stream_context"));
    try {
      const result = await novelAiChapterSummaryInspire(
        nid, { chapter_id: activeId, chapter_count: batchChapterCount }, request.options.onToken, request.options
      );
      if (!request.isCurrent()) return;
      setBatchSummary(result.summary); request.complete(result.summary);
    } catch (e) {
      if (novelIdRef.current === nid) {
        request.fail(apiErrorMessage(e));
        if (request.isCurrent()) setErr(apiErrorMessage(e));
      }
    } finally {
      setBatchSummaryInspireBusy(false);
      setBusy(false);
    }
  }

  async function onGenerate() {
    if (!canMutateChapter()) return;
    const nid = id;
    const s = summary.trim();
    if (!s) {
      setErr(t("write_err_summary_required"));
      return;
    }
    if (!activeId) return;
    try { await flushSave(); } catch (error) { setErr(apiErrorMessage(error)); return; }
    preGenerateSnapshotRef.current = { title, summary, content };
    const savedContent = content;
    const savedTitle = title;
    bodyStreamingRef.current = true;
    setBusy(true);
    setErr("");
    setPreviewResult(null);
    setIsPreviewMode(false);
    if (narrow) setRightTool(null);
    const request = ai.begin("generate", t("write_ai_generate"), t("ai_stream_context"));
    try {
      const result = await generateChapter(nid, s, {
        chapterId: activeId,
        title: singleGenerateLockTitle ? singleGenerateTitle.trim() || null : null,
        lockTitle: singleGenerateLockTitle,
        ...request.options,
      });
      if (novelIdRef.current !== nid || !request.isCurrent()) return;

      if (result.preview) {
        setIsPreviewMode(true);
        setReviewRejected(new Set());
        setReviewMetadata(true);
        setPreviewResult(result.preview);
        setReviewedDraft(normalizeBodyParagraphIndent(result.preview.content));
        request.complete(normalizeBodyParagraphIndent(result.preview.content), true);
        if (result.preview.evaluate_result) {
          setEvaluateResult(result.preview.evaluate_result);
        }
      } else if (result.chapter) {
        const ch = result.chapter;
        const full = await loadChapters();
        if (novelIdRef.current !== nid || !request.isCurrent()) return;
        setChapters(full);
        setActiveId(ch.id);
        lastLoadedChapterIdRef.current = null;
        setTitle(ch.title);
        setSummary(ch.summary);
        setContent(normalizeBodyParagraphIndent(ch.content));
        setSingleGenerateTitle("");
        setSingleGenerateLockTitle(false);
      } else {
        throw new Error(t("write_err_no_result"));
      }
    } catch (e) {
      if (novelIdRef.current === nid) {
        request.fail(apiErrorMessage(e));
        if (request.isCurrent()) setErr(apiErrorMessage(e));
        setTitle(savedTitle);
        setContent(savedContent);
      }
    } finally {
      bodyStreamingRef.current = false;
      setBusy(false);
    }
  }

  async function onBatchGenerate() {
    if (!canMutateChapter()) return;
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
    if (!canMutateChapter()) return;
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
      await flushSave();
      await createSingleBackgroundTask({
        novel_id: nid,
        chapter_id: activeId,
        title: singleGenerateLockTitle ? singleGenerateTitle.trim() || null : null,
        summary: s,
        fixed_title: singleGenerateLockTitle ? (singleGenerateTitle.trim() || null) : null,
        task_type: hasBody ? "rewrite_chapter" : "single_chapter",
      });
      
      setBusy(false);
      nav("/tasks");
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onBatchGenerateBackground() {
    if (!canMutateChapter()) return;
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
      });
      
      setBusy(false);
      nav("/tasks");
    } catch (e) {
      if (novelIdRef.current === nid) {
        setErr(apiErrorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  }

  async function onRunRevision(mode: "rewrite" | "append") {
    if (!canMutateChapter() || !activeId) return;
    const instruction = mode === "rewrite" ? rewriteInstr.trim() : appendInstr.trim();
    if (!instruction) { setErr(t(mode === "rewrite" ? "write_err_rewrite_instr_required" : "write_err_append_instr_required")); return; }
    if (mode === "rewrite" && !hasBody) { setErr(t("write_err_rewrite_needs_body")); return; }
    const nid = id;
    setBusy(true); setErr("");
    if (narrow) setRightTool(null);
    const request = ai.begin(mode, t(mode === "rewrite" ? "write_ai_rewrite" : "write_ai_append"), t("ai_stream_context"));
    try {
      await flushSave();
      if (!request.isCurrent()) return;
      preGenerateSnapshotRef.current = { title, summary, content };
      bodyStreamingRef.current = true;
      const preview = await previewChapterRevision(nid, activeId, instruction, preferredLlm, mode, request.options);
      if (!request.isCurrent()) return;
      setPreviewResult(preview); setIsPreviewMode(true); setReviewRejected(new Set()); setReviewMetadata(true);
      const draft = normalizeBodyParagraphIndent(preview.content);
      setReviewedDraft(draft); request.complete(draft, true);
      setRightTool(narrow ? null : "generate");
    } catch (error) {
      request.fail(apiErrorMessage(error));
      if (request.isCurrent()) setErr(apiErrorMessage(error));
    } finally { bodyStreamingRef.current = false; setBusy(false); }
  }
  const onRunRewrite = () => onRunRevision("rewrite");
  const onRunAppend = () => onRunRevision("append");

  async function onRunNaming() {
    if (!canMutateChapter()) return;
    const d = namingDesc.trim();
    if (!d) {
      setErr(t("write_err_naming_desc_required"));
      return;
    }
    if (narrow) setRightTool(null);
    const request = ai.begin("naming", t("write_ai_naming"), t("ai_stream_context"));
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
          request.options.onToken?.(chunk);
          if (!request.isCurrent()) return;
          fullText += chunk;
          const names = fullText
            .split("\n")
            .map((n) => n.trim())
            .filter((n) => n);
          setNamingResult(names);
        },
        request.options
      );
      if (!request.isCurrent()) return;
      request.complete(text);
      const finalNames = text
        .split("\n")
        .map((n) => n.trim())
        .filter((n) => n);
      setNamingResult(finalNames);
    } catch (e) {
      request.fail(apiErrorMessage(e));
      if (request.isCurrent()) setErr(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onRunEvaluate() {
    if (!canMutateChapter()) return;
    const aid = activeId;
    if (aid === null) return;
    if (!(content || "").trim()) {
      setErr(t("write_err_evaluate_needs_body"));
      return;
    }
    if (!(await confirmAction(t("write_confirm_evaluate_chapter")))) return;
    setEvaluateBusy(true);
    setBusy(true);
    const request = ai.begin("evaluate", t("write_ai_quick_check"), t("write_evaluating"));
    setRightTool(null);
    window.dispatchEvent(new Event("inkmind:assistant-minimize"));
    setErr("");
    setEvaluateResult(null);
    setEvaluatePanelPos(getEvaluatePanelDefaultPos());
    try {
      const data = await evaluateChapter(
        id,
        aid,
        {
          title,
          summary,
          content,
          llm_provider: preferredLlm,
        },
        request.options
      );
      if (!request.isCurrent()) return;
      setEvaluateResult(data);
      request.complete();
    } catch (e) {
      request.fail(apiErrorMessage(e));
      if (request.isCurrent()) setErr(apiErrorMessage(e));
    } finally {
      setEvaluateBusy(false);
      setBusy(false);
    }
  }

  const assistantDockRef = useCallback((node: HTMLDivElement | null) => {
    if (node) window.dispatchEvent(new Event("inkmind:assistant-dock-ready"));
  }, []);

  if (loading) {
    return <p className="muted">{t("write_loading_chapters")}</p>;
  }

  const generationModelLabel = modelSelection?.generationModel || t("ai_settings_not_configured");
  const drawerOpen = Boolean(rightTool && activeId !== null);
  const drawerTitle = rightTool
    ? ({
        generate: t("write_ai_generate"),
        rewrite: t("write_ai_rewrite"),
        append: t("write_ai_append"),
        naming: t("write_ai_naming"),
        versions: t("write_version_versions"),
      } satisfies Record<AiTool, string>)[rightTool]
    : "";
  const selectionPanelPosition = selectionPanel && selectionMenuPos
    ? (selectionPanelPos ?? { left: selectionMenuPos.left, top: selectionMenuPos.top + 8 })
    : null;
  const evaluatePanelPosition = evaluateResult
    ? (evaluatePanelPos ?? getEvaluatePanelDefaultPos())
    : null;

  return (
    <div className={`write-shell write-layout write-theme--${theme}${focusMode ? " write-focus-mode" : ""}${layout.overlay ? " write-layout--sidebar-overlay" : ""}${layout.resizing ? " write-layout--resizing" : ""}`} style={layout.style}>
      {modalContextHolder}
      <Modal
        open={previewLeaveOpen}
        title={t("write_preview_leave_title")}
        centered
        closable={!previewLeaveBusy}
        maskClosable={!previewLeaveBusy}
        keyboard={!previewLeaveBusy}
        onCancel={() => finishPreviewLeave(false)}
        footer={(
          <div className="write-preview-leave-actions">
            <button type="button" className="btn btn-ghost" autoFocus disabled={previewLeaveBusy} onClick={() => finishPreviewLeave(false)}>
              {t("write_stay_on_chapter")}
            </button>
            <button type="button" className="btn btn-danger" disabled={previewLeaveBusy} onClick={handleDiscardPreviewAndLeave}>
              {t("write_discard_and_continue")}
            </button>
            <button type="button" className="btn btn-primary" disabled={previewLeaveBusy} onClick={() => void handleAcceptPreviewAndLeave()}>
              {previewLeaveBusy ? t("write_saving") : t("write_accept_and_continue")}
            </button>
          </div>
        )}
      >
        <p className="write-preview-leave-copy">{t("write_preview_leave_message")}</p>
      </Modal>
      {err ? <p className="form-error write-err-banner" role="alert">{err}</p> : null}
      {recoveryDraft && (
        <div className="write-notice" role="status">
          <span>{t("write_draft_found")}</span>
          <button type="button" className="btn btn-primary" onClick={() => {
            setTitle(recoveryDraft.title); setSummary(recoveryDraft.summary); setContent(recoveryDraft.content);
            setRecoveryDraft(null); setErr("");
          }}>{t("write_restore_draft")}</button>
          <button type="button" className="btn btn-ghost" onClick={async () => {
            if (!(await confirmAction(t("write_discard_draft_confirm")))) return;
            if (user && activeId) {
              try { localStorage.removeItem(draftKey(user.id, id, activeId)); } catch { /* ignore */ }
            }
            setRecoveryDraft(null); setErr("");
          }}>{t("write_keep_server")}</button>
        </div>
      )}
      {layout.overlay && sidebarOpen && !focusMode ? (
        <button
          type="button"
          className="write-sidebar-backdrop"
          aria-label={t("write_close_chapter_list")}
          onClick={closeOverlay}
        />
      ) : null}

      <div className="write-workspace-toolbar">
        <EditorSettings
          settings={editorSettings}
          sidebarToolsRef={sidebarToolsRef}
          sidebarOpen={sidebarOpen}
          sidebarAutoCollapsed={!narrow && layout.autoCollapsed}
          layoutControls={<WritingLayoutControls layout={layout} />}
          onToggleSidebar={layout.toggleSidebar}
          onDrawerClose={handleDrawerClose}
        />
        {!focusMode && activeId ? (
          <div className="write-action-strip">
            <div className="write-ai-quickbar" aria-label={t("write_ai_quickbar_label")}>
              <button
                type="button"
                className={`write-ai-quickbtn${!hasBody ? " is-primary" : ""}${rightTool === "generate" ? " is-active" : ""}`}
                disabled={!hasLlm || busy}
                onClick={() => setRightTool("generate")}
              >
                <ThunderboltOutlined aria-hidden="true" />
                {t("write_ai_quick_generate")}
              </button>
              <button
                type="button"
                className={`write-ai-quickbtn${rightTool === "rewrite" ? " is-active" : ""}`}
                disabled={!hasLlm || busy || !hasBody}
                onClick={() => setRightTool("rewrite")}
              >
                <EditOutlined aria-hidden="true" />
                {t("write_ai_quick_rewrite")}
              </button>
              <button
                type="button"
                className={`write-ai-quickbtn${hasBody ? " is-primary" : ""}${rightTool === "append" ? " is-active" : ""}`}
                disabled={!hasLlm || busy}
                onClick={() => setRightTool("append")}
              >
                <ForwardOutlined aria-hidden="true" />
                {t("write_ai_quick_continue")}
              </button>
              <button
                type="button"
                className="write-ai-quickbtn"
                disabled={!hasLlm || evaluateBusy || busy || !activeId}
                onClick={() => void onRunEvaluate()}
              >
                <CheckCircleOutlined aria-hidden="true" />
                {evaluateBusy ? t("write_evaluating") : t("write_ai_quick_check")}
              </button>
              <Dropdown trigger={["click"]} menu={{ items: [
                { key: "naming", label: t("write_ai_naming"), onClick: () => setRightTool("naming"), disabled: !hasLlm || busy },
              ] }}><button type="button" className="write-ai-quickbtn" aria-label={t("dashboard_more")}><MoreOutlined /></button></Dropdown>
            </div>
            <button
              type="button"
              className={`write-history-btn${rightTool === "versions" ? " is-active" : ""}`}
              disabled={!activeId}
              onClick={toggleVersionsPanel}
            >
              {t("write_tool_versions")}
            </button>
          </div>
        ) : null}
        {!focusMode && <div className="write-workspace-toolbar__actions">
          <button className={`btn btn-ghost${referenceOpen ? " is-active" : ""}`} aria-label={t("reference_title")} aria-expanded={referenceOpen} onClick={() => {
            setReferenceOpen((v) => !v); setRightTool(null); window.dispatchEvent(new Event("inkmind:assistant-minimize"));
          }}><ReadOutlined />{t("reference_title")}</button>
          <button className={`btn btn-ghost write-assistant-trigger${assistantOpen ? " is-active" : ""}`} aria-label={t("write_ai_quick_ask")} aria-expanded={assistantOpen} onClick={() => assistantOpen ? window.dispatchEvent(new Event("inkmind:assistant-minimize")) : handleOpenSmartWriterPrompt("")}><RobotOutlined />{t("write_ai_quick_ask")}</button>
        </div>}
      </div>
      <div ref={layout.stageRef} className={`write-stage${!focusMode && (drawerOpen || assistantOpen || referenceOpen || selectionPanel || (evaluateResult && ai.operation?.kind !== "evaluate")) ? " write-stage--with-panel" : ""}`}>
      <div className={`write-workspace${sidebarOpen ? " write-workspace--sidebar-open" : ""}`}>


        <div id="write-chapter-pane" className="write-chapter-pane" hidden={!sidebarOpen}>
        <ChapterSidebar
          chapters={chapters}
          activeId={activeId}
          sidebarOpen={sidebarOpen}
          onSelectChapter={selectChapter}
          onAddChapter={onAddChapter}
          onDeleteChapter={onDeleteChapterById}
          disabled={busy || isPreviewMode || previewLoading || versionActionLoading || Boolean(recoveryDraft)}
          selectionDisabled={busy || previewLoading || versionActionLoading || Boolean(recoveryDraft)}
        />
        </div>
        {!narrow && sidebarOpen && !layout.overlay && <WritingPaneResizeHandle pane="chapters" layout={layout} />}

        <div className="write-main write-main--with-rail">
          <div className="card write-editor-card">
            {activeId ? (
              <>
                <div className="write-editor-header">
                  <div className="write-editor-title-row">
                    <div className="write-editor-nav">
                      <button
                        type="button"
                        className="write-icon-btn write-nav-btn"
                        disabled={!hasPrevChapter}
                        title={t("write_prev_chapter")}
                        aria-label={t("write_prev_chapter")}
                        onClick={goToPrevChapter}
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3L5 8l5 5" /></svg>
                      </button>
                      <button
                        type="button"
                        className="write-icon-btn write-nav-btn"
                        disabled={!hasNextChapter}
                        title={t("write_next_chapter")}
                        aria-label={t("write_next_chapter")}
                        onClick={goToNextChapter}
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3l5 5-5 5" /></svg>
                      </button>
                    </div>
                    <input
                      className="editor-title editor-title--improved"
                      aria-label={t("write_chapter_title_placeholder")}
                      readOnly={busy || isPreviewMode || Boolean(recoveryDraft) || versionActionLoading}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder={t("write_chapter_title_placeholder")}
                    />
                  </div>
                  <div className="write-editor-subtitle-row">
                    <div className="write-chapter-meta">
                      <button
                        type="button"
                        className="write-summary-toggle"
                        onClick={() => setSummaryOpen((v) => !v)}
                        aria-expanded={summaryOpen}
                        aria-label={summaryOpen ? t("write_summary_collapse") : t("write_summary_expand")}
                      >
                        <svg className={`write-summary-toggle__chevron${summaryOpen ? " is-open" : ""}`} width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5l3 3 3-3" /></svg>
                        <span className="write-summary-toggle__label">{t("write_chapter_summary")}</span>
                      </button>
                      <span className={`write-save-status write-save-status--${isPreviewMode ? "preview" : saveStatus}`} role="status" aria-live="polite">
                        {!isPreviewMode && saveStatus === "saving" && <span className="write-save-dot write-save-dot--saving" aria-hidden />}
                        {!isPreviewMode && saveStatus === "saved" && <span className="write-save-dot write-save-dot--saved" aria-hidden />}
                        {(isPreviewMode || saveStatus === "unsaved") && <span className="write-save-dot write-save-dot--unsaved" aria-hidden />}
                        {isPreviewMode ? t("write_preview_not_saved") : busy ? t("write_ai_working") : saveStatus === "error" ? t("write_save_failed") : saveStatus === "saving" ? t("write_saving") : saveStatus === "saved" ? t("write_saved") : t("write_save_pending")}
                      </span>
                      {saveStatus === "error" && !busy && !isPreviewMode && (
                        <button type="button" className="write-retry-save" onClick={() => {
                          setErr(""); void flushSave().catch((error) => setErr(apiErrorMessage(error)));
                        }}>{t("write_retry_save")}</button>
                      )}
                      <span className="write-meta-word-stat">{wordCountText}</span>
                    </div>
                  </div>
                  {summaryOpen && (
                    <div className="write-summary-panel">
                      <textarea
                        className="textarea write-summary-textarea"
                        aria-label={t("write_chapter_summary")}
                        readOnly={busy || isPreviewMode || Boolean(recoveryDraft) || versionActionLoading}
                        rows={summaryRows}
                        value={summary}
                        onChange={(e) => setSummary(e.target.value)}
                        placeholder={t("write_chapter_summary_placeholder")}
                      />
                    </div>
                  )}
                  {!hasLlm && !focusMode && (
                    <p className="write-ai-unavailable">{t("write_ai_unavailable")} <button type="button" className="write-retry-save" onClick={() => nav("/settings")}>{t("nav_ai_settings")}</button></p>
                  )}
                </div>
                {ai.operation && !(ai.operation.kind === "selection" && selectionPanel && !focusMode) && <AiOperationPanel operation={ai.operation} onCancel={ai.cancel} onDismiss={ai.dismiss}
                  report={isPreviewMode ? previewResult?.evaluate_result : ai.operation.kind === "evaluate" ? evaluateResult : null}
                  onEdit={isPreviewMode && !previewLoading ? (text) => { setReviewedDraft(text); ai.replaceText(text); setPreviewResult((preview) => preview ? { ...preview, content: text } : null); setReviewRejected(new Set()); } : undefined} />}
                <div className={`write-body-wrapper write-body-wrapper--${lineWidthId}`}>
                  <div className="field write-body-field">
                    <textarea
                      ref={bodyTextareaRef}
                      aria-label={t("write_body_label")}
                      readOnly={busy || isPreviewMode || Boolean(recoveryDraft) || versionActionLoading}
                      onBlur={rememberPosition}
                      onScroll={rememberPosition}
                      className={`textarea editor-body editor-body--line-height-${lineHeightId}${typewriterMode === "on" ? " editor-body--typewriter" : ""}`}
                      style={{ fontSize: `${bodyFontSizePx}px` }}
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      onKeyDown={handleBodyKeyDown}
                      onMouseUp={syncSelectionFromTextarea}
                      onSelect={() => { syncSelectionFromTextarea(); rememberPosition(); }}
                      onKeyUp={syncSelectionFromTextarea}
                      placeholder={t("write_start_writing")}
                    />
                  </div>
                </div>
                {isPreviewMode ? (
                  <div className="write-preview-resolution">
                    <div className="write-preview-resolution__message" role="status" aria-live="polite" aria-atomic="true">
                      <span className="write-preview-resolution__dot" aria-hidden="true" />
                      <span>
                        <strong>{t("write_preview_bar_title")}</strong>
                        <small>{t("write_preview_bar_hint")}</small>
                      </span>
                    </div>
                    <div className="write-preview-resolution__actions">
                      <button type="button" className="btn btn-ghost" disabled={previewLoading} onClick={() => {
                        if (focusMode) setFocusMode(() => false);
                        setRightTool("generate");
                      }}>
                        {t("write_preview_review")}
                      </button>
                      <button type="button" className="btn btn-ghost" disabled={previewLoading} onClick={onCancelPreview}>
                        {t("write_discard_preview")}
                      </button>
                      <button type="button" className="btn btn-primary" disabled={previewLoading} onClick={() => void onConfirmPreview()}>
                        {previewLoading ? t("write_saving") : t("write_accept_and_save")}
                      </button>
                    </div>
                  </div>
                ) : null}
                {focusMode ? (
                  <div className="write-editor-footer">
                    <button
                      type="button"
                      className="btn btn-ghost write-exit-focus-btn"
                      onClick={() => setFocusMode(() => false)}
                    >
                      {t("write_exit_focus_mode_esc")}
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="write-empty-start"><h2>{t("write_empty_title")}</h2><p className="muted">{t("write_empty_desc")}</p><button className="btn btn-primary" onClick={() => void onAddChapter()}>{t("write_new_chapter")}</button></div>
            )}
          </div>
        </div>
      </div>

      {!narrow && !focusMode && (drawerOpen || assistantOpen || referenceOpen || selectionPanel || (evaluateResult && ai.operation?.kind !== "evaluate")) && <WritingPaneResizeHandle pane="tools" layout={layout} />}

      {!focusMode && drawerOpen && rightTool && (
        <div
          ref={commandPanelRef}
          role="region"
          aria-label={drawerTitle}
          className={`write-ai-drawer${rightTool === "versions" ? " write-version-panel" : ` write-command-panel write-command-panel--${rightTool}`}${commandPanelDragging ? " is-dragging" : ""}`}
          style={rightTool !== "versions" && commandPanelPos ? {
            left: commandPanelPos.left,
            top: commandPanelPos.top,
            right: "auto",
          } : undefined}
        >
          <div className="write-ai-drawer-head" onPointerDown={handleCommandPanelDragStart}>
            <div className="write-ai-drawer-titleblock">
              {rightTool === "versions" && <span className="write-ai-drawer-eyebrow">{t("write_ai_panel_eyebrow")}</span>}
              <strong>{drawerTitle}</strong>
              {rightTool === "versions" ? <small>{t("write_version_desc")}</small> : null}
            </div>
            <button type="button" className="write-ai-close btn btn-ghost" onClick={() => setRightTool(null)}>
              {t("write_close")}
            </button>
          </div>
          {rightTool !== "versions" && <div className="write-command-context">
            <span>{rightTool === "naming" ? t("write_scope_reference") : rightTool === "generate" && generateTab === "batch" ? t("write_batch_chapters") : t(rightTool === "append" ? "write_scope_append" : "write_scope_chapter").replace("{title}", title || t("novel_untitled"))}</span>
            <span>{t("ai_settings_model")}: {generationModelLabel}</span>
          </div>}
          <div className="write-ai-drawer-body">
            {rightTool === "generate" && isPreviewMode && previewResult && <GenerationReview
              original={preGenerateSnapshotRef.current} proposal={{ ...previewResult, content: normalizeBodyParagraphIndent(previewResult.content) }}
              rejected={reviewRejected} useMetadata={reviewMetadata} disabled={previewLoading}
              onReview={(rejected, next) => { setReviewRejected(rejected); setReviewedDraft(next); ai.replaceText(next); }}
              onMetadata={setReviewMetadata}
            />}
            {rightTool === "generate" && activeId && !isPreviewMode ? (
              <div className="write-ai-section">
                {isLatestChapter ? (
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
                    <button
                      type="button"
                      role="tab"
                      aria-selected={generateTab === "batch"}
                      className={`write-generate-tab${generateTab === "batch" ? " is-active" : ""}`}
                      onClick={() => setGenerateTab("batch")}
                    >
                      {t("write_batch_chapters")}
                    </button>
                  </div>
                ) : null}

                {generateTab === "single" ? (
                  <>
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
                        rows={4}
                        value={summary}
                        onChange={(e) => setSummary(e.target.value)}
                        placeholder={t("write_summary_placeholder")}
                      />
                    </div>
                    <details className="write-generate-advanced">
                      <summary><span>{t("write_advanced_options")}{singleGenerateLockTitle ? ` · ${t("write_custom_title")}` : ""}</span></summary>
                      <div className="write-generate-advanced__content">
                        <label className="write-generate-lock">
                          <input type="checkbox" checked={singleGenerateLockTitle} onChange={(e) => {
                            setSingleGenerateLockTitle(e.target.checked);
                            if (e.target.checked && !singleGenerateTitle.trim()) setSingleGenerateTitle(title);
                          }} />
                          <span>{t("write_custom_title")}</span>
                        </label>
                        {singleGenerateLockTitle && <div className="field">
                          <label htmlFor="write-ai-generate-title">{t("write_chapter_title")}</label>
                          <input id="write-ai-generate-title" className="input" value={singleGenerateTitle} onChange={(e) => setSingleGenerateTitle(e.target.value)} placeholder={t("write_custom_title_placeholder")} />
                        </div>}
                        <p className="hint">{t(singleGenerateLockTitle ? "write_custom_title_hint" : "write_auto_title_hint")}</p>
                        {novel && !isNovelSetupComplete(novel) && <button type="button" className="write-retry-save" onClick={() => { setRightTool(null); setReferenceOpen(true); }}>{t("write_supplement_reference")}</button>}
                      </div>
                    </details>
                    <fieldset className="write-generate-delivery" disabled={busy}>
                      <legend className="sr-only">{t("write_generate_mode")}</legend>
                      {(["foreground", "background"] as const).map((mode) => (
                        <label key={mode}>
                          <input type="radio" name="generate-delivery" value={mode} checked={generateMode === mode} onChange={() => setGenerateMode(mode)} />
                          <span>{t(mode === "foreground" ? "write_delivery_here" : "write_delivery_background")}</span>
                        </label>
                      ))}
                    </fieldset>
                    <p className="write-generate-behavior">
                      {generateMode === "background" ? t("write_delivery_background_hint") : t("write_preview_behavior")}
                    </p>
                    <button
                      type="button"
                      className="btn btn-primary write-generate-submit"
                      disabled={busy || (singleGenerateLockTitle && !singleGenerateTitle.trim())}
                      onClick={generateMode === "background" ? () => void onGenerateBackground() : onGenerate}
                    >
                      {busy ? t("write_generating") : generateMode === "background" ? t("write_submit_background") : t("write_generate_preview")}
                    </button>


                    {previewResult ? (
                      <div className="stack-sm write-eval-block">
                        <div
                          className={`card ${
                            previewResult.needs_revision ? "border-warning" : "border-success"
                          } write-preview-card`}
                        >
                          <p className="write-preview-card-title">
                            {previewResult.needs_revision
                              ? t("write_preview_low_score")
                              : t("write_preview_ready")}
                          </p>
                          {previewResult.evaluate_result && (
                            <p className="write-preview-card-sub">
                              {t("write_deai_score").replace("{score}", String(previewResult.evaluate_result.de_ai_score))}
                              {previewResult.evaluate_result.issues.length > 0 && (
                                <span>{t("write_issues_found").replace("{count}", String(previewResult.evaluate_result.issues.length))}</span>
                              )}
                            </p>
                          )}
                        </div>
                        <div className="write-preview-actions">
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={previewLoading}
                            onClick={() => void onConfirmPreview()}
                          >
                            {previewLoading ? t("write_saving") : t("write_accept_and_save")}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={previewLoading}
                            onClick={onCancelPreview}
                          >
                            {t("write_discard_preview")}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
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
                      <p className="muted write-batch-note">
                        {t("write_batch_latest_only_note")}
                      </p>
                    ) : null}
                    <div className="field write-field-mb">
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
                        rows={5}
                        value={batchSummary}
                        onChange={(e) => setBatchSummary(e.target.value)}
                        placeholder={t("write_batch_summary_placeholder")}
                      />
                    </div>
                    <fieldset className="write-generate-delivery" disabled={busy}>
                      <legend className="sr-only">{t("write_generate_mode")}</legend>
                      {(["foreground", "background"] as const).map((mode) => (
                        <label key={mode}>
                          <input type="radio" name="generate-delivery" value={mode} checked={generateMode === mode} onChange={() => setGenerateMode(mode)} />
                          <span>{t(mode === "foreground" ? "write_delivery_here" : "write_delivery_background")}</span>
                        </label>
                      ))}
                    </fieldset>
                    <p className="write-generate-behavior">
                      {generateMode === "background" ? t("write_delivery_background_hint") : t("write_direct_behavior")}
                    </p>
                    <button
                      type="button"
                      className="btn btn-primary write-generate-submit"
                      disabled={busy || !isLatestChapter}
                      onClick={generateMode === "background" ? () => void onBatchGenerateBackground() : onBatchGenerate}
                    >
                      {busy ? t("write_batch_generating") : generateMode === "background" ? t("write_submit_background") : `${t("write_batch_generate_n")} ${batchChapterCount ?? 0} ${t("write_batch_generate_n_suffix")}`}
                    </button>
                    {generateMode === "foreground" && batchStreaming ? (
                      <div className="write-generate-log" role="status" aria-live="polite">{batchStreaming}</div>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}

            {rightTool === "rewrite" && activeId ? (
              <div className="write-ai-section">
                <div className="field write-ai-command-field">
                  <label htmlFor="write-ai-rewrite-instruction">{t("write_rewrite_instruction_label")}</label>
                  <textarea
                    id="write-ai-rewrite-instruction"
                    className="textarea"
                    rows={5}
                    value={rewriteInstr}
                    onChange={(e) => setRewriteInstr(e.target.value)}
                    placeholder={t("write_rewrite_placeholder")}
                  />
                </div>
                {novel && !isNovelSetupComplete(novel) && <details className="write-generate-advanced">
                  <summary><span>{t("write_advanced_options")}</span></summary>
                  <div className="write-generate-advanced__content">
                    <button type="button" className="write-retry-save" onClick={() => { setRightTool(null); setReferenceOpen(true); }}>{t("write_supplement_reference")}</button>
                  </div>
                </details>}
                <p className="write-command-behavior">{t("write_preview_behavior")}</p>
                <div className="write-ai-command-actions">
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={onRunRewrite}>
                    {busy ? t("write_processing") : t("write_rewrite")}
                  </button>
                </div>
              </div>
            ) : null}

            {rightTool === "append" && activeId ? (
              <div className="write-ai-section">
                <div className="field write-ai-command-field">
                  <label htmlFor="write-ai-append-instruction">{t("write_append_instruction_label")}</label>
                  <textarea
                    id="write-ai-append-instruction"
                    className="textarea"
                    rows={5}
                    value={appendInstr}
                    onChange={(e) => setAppendInstr(e.target.value)}
                    placeholder={t("write_append_placeholder")}
                  />
                </div>
                {novel && !isNovelSetupComplete(novel) && <details className="write-generate-advanced">
                  <summary><span>{t("write_advanced_options")}</span></summary>
                  <div className="write-generate-advanced__content">
                    <button type="button" className="write-retry-save" onClick={() => { setRightTool(null); setReferenceOpen(true); }}>{t("write_supplement_reference")}</button>
                  </div>
                </details>}
                <p className="write-command-behavior">{t("write_preview_behavior")}</p>
                <div className="write-ai-command-actions">
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={onRunAppend}>
                    {busy ? t("write_processing") : t("write_append")}
                  </button>
                </div>
              </div>
            ) : null}

            {rightTool === "naming" ? (
              <div className="write-ai-section">
                <div className="field">
                  <label htmlFor="write-naming-category">{t("write_naming_category")}</label>
                  <select
                    id="write-naming-category"
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
                  <label htmlFor="write-naming-description">{t("write_naming_object")}</label>
                  <textarea
                    id="write-naming-description"
                    className="textarea"
                    rows={3}
                    value={namingDesc}
                    onChange={(e) => setNamingDesc(e.target.value)}
                    placeholder={t("write_naming_object_placeholder")}
                  />
                </div>
                <details className="write-generate-advanced">
                  <summary><span>{t("write_naming_preferences")}{namingHint.trim() ? ` · ${t("write_options_configured")}` : ""}</span></summary>
                  <div className="write-generate-advanced__content">
                    <div className="field">
                      <label htmlFor="write-naming-preferences">{t("write_naming_hint_label")}</label>
                      <textarea id="write-naming-preferences" className="textarea textarea-compact" rows={2} value={namingHint} onChange={(e) => setNamingHint(e.target.value)} placeholder={t("write_naming_hint_placeholder")} />
                    </div>
                    {novel && !isNovelSetupComplete(novel) && <button type="button" className="write-retry-save" onClick={() => { setRightTool(null); setReferenceOpen(true); }}>{t("write_supplement_reference")}</button>}
                  </div>
                </details>
                <p className="write-command-behavior">{t("write_naming_behavior")}</p>
                <button type="button" className="btn btn-primary write-command-submit" disabled={busy} onClick={onRunNaming}>
                  {busy ? t("write_generating") : t("write_naming_generate")}
                </button>
                {namingResult && namingResult.length > 0 ? (
                  <div className="write-naming-results stack-sm">
                    {namingResult.map((name, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className={`write-naming-result-btn${namingSelectedIndex === idx ? " is-selected" : ""}`}
                        aria-pressed={namingSelectedIndex === idx}
                        onClick={() => setNamingSelectedIndex(idx)}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {rightTool === "versions" && activeId ? (
              <div className="write-ai-section write-version-section">
                <div className="write-version-panel-inner">
                  <div className="write-version-toolbar">
                    <span className="muted">
                      {t("write_version_count").replace("{count}", String(versions.length))}
                    </span>
                    <button
                      type="button"
                      className="write-version-refresh"
                      disabled={versionsLoading}
                      onClick={() => loadVersions()}
                    >
                      {t("common_refresh")}
                    </button>
                  </div>
                  
                  {versionsLoading ? (
                    <p className="muted write-version-empty">
                      {t("write_loading_versions")}
                    </p>
                  ) : versions.length === 0 ? (
                    <p className="muted write-version-empty">
                      {t("write_no_versions")}
                    </p>
                  ) : (
                    <div className="write-version-list">
                      <div className="write-version-stack">
                        {versions.map((v) => (
                          <div
                            key={v.id}
                            role="button"
                            tabIndex={0}
                            aria-pressed={selectedVersion?.id === v.id}
                            onKeyDown={(event) => {
                              if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                                event.preventDefault(); setSelectedVersion(v); setVersionDiff(null);
                              }
                            }}
                            className={`version-item${selectedVersion?.id === v.id ? " version-item--active" : ""}`}
                            onClick={() => {
                              setSelectedVersion(v);
                              setVersionDiff(null);
                            }}
                          >
                            <div className="version-item__main">
                              <div className="version-item__content">
                                <div className="version-item__head">
                                  <strong>
                                    {t("write_version_n")} {v.version_number}
                                  </strong>
                                  <span
                                    className="version-type-badge"
                                    data-ai={v.change_type.startsWith("ai") || v.change_type.startsWith("selection")}
                                  >
                                    {v.change_type === "manual" && t("write_change_manual")}
                                    {v.change_type === "ai_generate" && t("write_change_ai_gen")}
                                    {v.change_type === "ai_rewrite" && t("write_change_ai_rewrite")}
                                    {v.change_type === "ai_append" && t("write_change_ai_append")}
                                    {v.change_type === "selection_rewrite" && t("write_change_ai_rewrite")}
                                    {v.change_type === "selection_expand" && t("write_change_ai_expand")}
                                    {v.change_type === "selection_polish" && t("write_change_ai_polish")}
                                    {v.change_type === "selection_append" && t("write_change_ai_append")}
                                    {v.change_type === "rollback" && t("write_change_rollback")}
                                  </span>
                                </div>
                                {v.title && (
                                  <p className="version-item__title">
                                    {t("write_version_title").replace("{title}", v.title.length > 30 ? v.title.slice(0, 30) + "…" : v.title)}
                                  </p>
                                )}
                                <div className="version-item__meta">
                                  <span>{new Date(v.created_at).toLocaleString()}</span>
                                  <span>{t("write_version_word_count").replace("{count}", String(v.content.replace(/\s/g, "").length))}</span>
                                </div>
                              </div>
                            </div>
                            
                            {selectedVersion?.id === v.id && (
                              <div className="version-item__actions">
                                <div className="version-item__button-row">
                                  <button
                                    type="button"
                                    className="write-version-action"
                                    disabled={versionDiffLoading || versionActionLoading}
                                    onClick={() => compareSelectedVersionWithCurrent(v.id)}
                                  >
                                    {versionDiffLoading ? t("write_comparing") : t("write_compare_with_current")}
                                  </button>
                                  <button
                                    type="button"
                                    className="write-version-action"
                                    disabled={versionActionLoading}
                                    onClick={() => handleRollback(v.id, true)}
                                  >
                                    {t("write_rollback_save_current")}
                                  </button>
                                  <button
                                    type="button"
                                    className="write-version-action write-version-action--danger"
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
                    <div className="write-version-diff-section">
                      <h4 className="write-version-diff-header">{t("write_version_diff_title")}</h4>
                      <div className="write-version-diff-stats">
                        <span className="write-version-diff-stats--added">{t("write_version_diff_added").replace("{count}", String(versionDiff.added_count))}</span>
                        <span className="write-version-diff-stats--removed">{t("write_version_diff_removed").replace("{count}", String(versionDiff.removed_count))}</span>
                        <span className="write-version-diff-stats--changed">{t("write_version_diff_changed").replace("{count}", String(versionDiff.changed_count))}</span>
                      </div>
                      <div
                        className="version-diff-container"
                        dangerouslySetInnerHTML={{ __html: versionDiff.diff_html }}
                      />
                    </div>
                  )}
                  
                  {selectedVersion && !versionDiff && (
                    <div className="write-version-preview-section">
                      <h4 className="write-version-preview-title">{t("write_version_preview_title")}</h4>
                      {selectedVersion.summary && (
                        <div className="write-mb-sm">
                          <strong className="write-version-preview-summary-label">{t("write_version_summary")}</strong>
                          <p className="write-version-preview-summary-text">
                            {selectedVersion.summary}
                          </p>
                        </div>
                      )}
                      <div>
                        <strong className="write-version-preview-content-label">{t("write_version_content")}</strong>
                        <pre className="write-version-preview-content-pre">
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

      {!focusMode && !assistantOpen && !referenceOpen && !rightTool && !selectionPanel && evaluateResult && ai.operation?.kind !== "evaluate" && evaluatePanelPosition ? (
        <div
          ref={evaluatePanelRef}
          className={`write-evaluate-panel${evaluatePanelDragging ? " is-dragging" : ""}`}
          role="dialog"
          aria-label={t("write_ai_check_result_title")}
          style={{ left: evaluatePanelPosition.left, top: evaluatePanelPosition.top }}
        >
          <div className="write-evaluate-panel__head" onPointerDown={handleEvaluatePanelDragStart}>
            <div className="write-evaluate-panel__title">
              <span className="write-evaluate-panel__badge">AI</span>
              <div>
                <strong>{t("write_ai_check_result_title")}</strong>
                <small>
                  {evaluateResult.issues.length > 0
                    ? t("write_ai_check_issue_count").replace("{count}", String(evaluateResult.issues.length))
                    : t("write_evaluate_no_issues")}
                </small>
              </div>
            </div>
            <button
              type="button"
              className="write-evaluate-panel__close"
              onClick={() => {
                setEvaluateResult(null);
                setEvaluatePanelPos(null);
              }}
            >
              {t("write_close")}
            </button>
          </div>
          <div className="write-evaluate-panel__body">
            <div className="write-evaluate-panel__score" aria-label={t("write_deai_score_aria")}>
              <span className="write-evaluate-panel__score-num">{evaluateResult.de_ai_score}</span>
              <span className="write-evaluate-panel__score-denom">/ 100</span>
              <span className="write-evaluate-panel__score-label">{t("write_deai_score_desc")}</span>
            </div>
            {evaluateResult.issues.length > 0 ? (
              <div className="write-evaluate-panel__issues" aria-label={t("write_evaluate_issues")}>
                {evaluateResult.issues.map((it, i) => (
                  <article key={`${it.aspect}-${i}`} className="write-evaluate-panel__issue">
                    <span className="write-evaluate-panel__issue-index">{i + 1}</span>
                    <div>
                      <strong>{it.aspect}</strong>
                      <p>{it.detail}</p>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="write-evaluate-panel__empty">{t("write_no_issues_found")}</p>
            )}
          </div>
        </div>
      ) : null}

      {showSelectionBar && selectionMenuPos ? (
        <SelectionFloatMenu
          top={selectionMenuPos.top}
          left={selectionMenuPos.left}
          busy={busy}
          onRunAi={(mode) => void runSelectionAi(mode)}
          onAddToMemo={() => void addSelectionToMemo()}
        />
      ) : null}

      {!focusMode && !assistantOpen && !referenceOpen && !rightTool && selectionPanel && selectionPanelPosition ? (
        <div
          ref={selectionPanelRef}
          className={`write-selection-result-float${selectionPanelDragging ? " is-dragging" : ""}`}
          role="status"
          style={{ top: selectionPanelPosition.top, left: selectionPanelPosition.left }}
        >
          <div className="write-selection-result-float__head" onPointerDown={handleSelectionPanelDragStart}>
            <div className="write-selection-result-float__title">
              <span className="write-selection-result-float__badge">AI</span>
              <span>
                {selectionPanel.mode === "rewrite" && t("write_selection_rewrite_title")}
                {selectionPanel.mode === "expand" && t("write_selection_expand_title")}
                {selectionPanel.mode === "polish" && t("write_selection_polish_title")}
                {selectionPanel.mode === "append" && t("write_selection_append_title")}
              </span>
            </div>
            <button type="button" className="write-selection-result-float__close" onClick={closeSelectionPanel}>
              {t("write_selection_exit")}
            </button>
          </div>
          <div className="write-command-context"><span>{t("write_scope_selection")}</span><span>{t("ai_settings_model")}: {generationModelLabel}</span></div>
          <div className="write-selection-result-float__body">
            <details className="selection-original"><summary>{t("review_original")}</summary><p>{content.slice(selectionPanel.start, selectionPanel.end)}</p></details>
            {ai.operation?.kind === "selection" ? <AiOperationPanel operation={ai.operation} onCancel={ai.cancel} onDismiss={closeSelectionPanel} /> : selectionPanel.streaming || (busy ? t("write_generating") : "")}
          </div>
          <div className="write-selection-result-float__actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !selectionPanel.text.trim()}
              onClick={applySelectionReplace}
            >
              {selectionPanel.mode === "append" ? t("write_selection_insert") : t("write_selection_replace")}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy || !selectionPanel.text.trim()}
              onClick={() => void copySelectionResult()}
            >
              {t("write_selection_copy")}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() =>
                void runSelectionAi(selectionPanel.mode, {
                  start: selectionPanel.start,
                  end: selectionPanel.end,
                })
              }
            >
              {t("write_selection_regenerate")}
            </button>
          </div>
        </div>
      ) : null}
      <div ref={assistantDockRef} id="write-assistant-dock" className="write-assistant-dock" hidden={!assistantOpen || focusMode} />
      {novel && user && <ReferencePanel key={`${user.id}:${id}`} novel={novel} userId={user.id} open={referenceOpen && !focusMode} onClose={() => setReferenceOpen(false)} />}
      </div>
    </div>
  );
}
