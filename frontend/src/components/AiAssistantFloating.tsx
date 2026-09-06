import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { useCallback, useEffect, useLayoutEffect, useState, useRef } from "react";
import {
  BookOutlined,
  CheckOutlined,
  CloseOutlined,
  CommentOutlined,
  DownOutlined,
  FileTextOutlined,
  PaperClipOutlined,
  PlusOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "@/i18n";
import {
  fetchNovels,
  fetchChapters,
  createAgentSession,
  agentChat,
  agentAnswerQuestion,
  updateAgentTaskOutput,
  interruptAgentSession,
  type AgentSession,
} from "@/api/client";
import type { PendingQuestionData, SseAgentStepData, SseChapterSavedData } from "@/types/sse";
import AskUserQuestion from "@/components/AskUserQuestion";
import AgentStepDisplay from "@/components/AgentStepDisplay";
import type { Chapter, Novel } from "@/types";

interface UploadedAttachment {
  id: string;
  kind: "file" | "chapter";
  name: string;
  size: number;
  type: string;
  content?: string;
  truncated?: boolean;
  chapterId?: number;
}

interface EditorSelectionContext {
  novelId: number;
  chapterId: number | null;
  chapterTitle?: string;
  text: string;
  lineCount: number;
  start?: number;
  end?: number;
}

interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "system" | "error" | "chapter_saved";
  content: string;
  attachments?: UploadedAttachment[];
  selectionContext?: EditorSelectionContext;
  postTaskContent?: string;
  timestamp: number;
  isStreaming?: boolean;
  savedChapter?: SseChapterSavedData;
  taskSections?: AgentTaskSection[];
  actionButtons?: ActionButton[];
}

interface AgentTaskSection {
  taskId: string;
  taskType: string;
  title: string;
  content: string;
  draftContent?: string;
  collapsed?: boolean;
  editing?: boolean;
  saving?: boolean;
  saved?: boolean;
}

interface ActionButton {
  label: string;
  type: "primary" | "default" | "danger";
  action: () => void;
}

export interface AiAssistantFloatingProps {
  novelId?: number;
  onChapterSaved?: (chapter: Partial<Chapter> & { id: number; title: string }) => void;
}

const SESSION_KEY = "inkmind_agent_session";
const PANEL_WIDTH_KEY = "inkmind_ai_panel_width";
const PANEL_RECT_KEY = "inkmind_ai_panel_rect";
const ICON_POS_KEY = "inkmind_ai_icon_pos";
const DEFAULT_PANEL_WIDTH = 560;
const DEFAULT_PANEL_HEIGHT = 720;
const MIN_PANEL_WIDTH = 380;
const MAX_PANEL_WIDTH = 980;
const MIN_PANEL_HEIGHT = 420;
const PANEL_MARGIN = 18;
const MAX_ATTACHMENT_CHARS = 64000;
const MAX_TOTAL_ATTACHMENT_CHARS = 160000;

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return fallback;
}

function saveJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function isLikelyTextFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  return /\.(txt|md|markdown|json|csv|tsv|yaml|yml|xml|html|css|js|jsx|ts|tsx|py|java|go|rs|rb|php|sql|log)$/i.test(file.name);
}

function buildAttachmentPrompt(input: string, attachments: UploadedAttachment[]): string {
  if (!attachments.length) return input;
  let remaining = MAX_TOTAL_ATTACHMENT_CHARS;
  const files = attachments.map((file, index) => {
    const label = file.kind === "chapter" ? "章节" : "文件";
    const meta = `${label} ${index + 1}: ${file.name}${file.kind === "file" ? ` (${formatFileSize(file.size)}${file.type ? `, ${file.type}` : ""})` : ""}`;
    if (!file.content) return `${meta}\n内容: 无法读取为文本，请仅参考文件名和类型。`;
    const content = file.content.slice(0, Math.max(0, remaining));
    remaining -= content.length;
    const suffix = file.truncated || file.content.length > content.length ? "\n[内容已截断]" : "";
    return `${meta}\n内容:\n${content}${suffix}`;
  }).join("\n\n---\n\n");

  return `${input || "请结合我添加的上下文提供帮助。"}\n\n[附加上下文]\n${files}`;
}

function buildEditorSelectionPrompt(input: string, selection: EditorSelectionContext | null): string {
  if (!selection?.text.trim()) return input;
  const title = selection.chapterTitle?.trim() ? `（${selection.chapterTitle.trim()}）` : "";
  return `${input || "请结合我选中的正文提供帮助。"}\n\n[正文选区上下文]\n章节${title}\n${selection.text}`;
}

function clampPanelWidth(width: number): number {
  const viewportMax = typeof window === "undefined" ? MAX_PANEL_WIDTH : window.innerWidth - 72;
  const maxWidth = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, viewportMax));
  return Math.min(maxWidth, Math.max(MIN_PANEL_WIDTH, Math.round(width)));
}

type PanelRect = { left: number; top: number; width: number; height: number };
type IconPos = { left: number; top: number };
type PanelResizeMode = "left" | "nw" | "ne" | "sw" | "se";

function defaultPanelRect(): PanelRect {
  if (typeof window === "undefined") {
    return { left: 960, top: 80, width: DEFAULT_PANEL_WIDTH, height: DEFAULT_PANEL_HEIGHT };
  }
  const width = clampPanelWidth(loadJson(PANEL_WIDTH_KEY, DEFAULT_PANEL_WIDTH));
  const height = Math.min(DEFAULT_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, window.innerHeight - 140));
  return {
    left: Math.max(PANEL_MARGIN, window.innerWidth - width - 28),
    top: Math.max(PANEL_MARGIN, window.innerHeight - height - 28),
    width,
    height,
  };
}

function clampPanelRect(rect: PanelRect): PanelRect {
  if (typeof window === "undefined") return rect;
  const maxWidth = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, window.innerWidth - PANEL_MARGIN * 2));
  const width = Math.min(maxWidth, Math.max(MIN_PANEL_WIDTH, Math.round(rect.width)));
  const maxHeight = Math.max(MIN_PANEL_HEIGHT, window.innerHeight - PANEL_MARGIN * 2);
  const height = Math.min(maxHeight, Math.max(MIN_PANEL_HEIGHT, Math.round(rect.height)));
  const left = Math.min(window.innerWidth - width - PANEL_MARGIN, Math.max(PANEL_MARGIN, Math.round(rect.left)));
  const top = Math.min(window.innerHeight - height - PANEL_MARGIN, Math.max(PANEL_MARGIN, Math.round(rect.top)));
  return { left, top, width, height };
}

function defaultIconPos(): IconPos {
  if (typeof window === "undefined") return { left: 24, top: 420 };
  return {
    left: Math.max(PANEL_MARGIN, window.innerWidth - 156),
    top: Math.max(PANEL_MARGIN, Math.min(window.innerHeight - 74, Math.round(window.innerHeight * 0.5))),
  };
}

function clampIconPos(pos: IconPos): IconPos {
  if (typeof window === "undefined") return pos;
  const iconWidth = window.innerWidth <= 480 ? 48 : 138;
  return {
    left: Math.min(window.innerWidth - iconWidth - PANEL_MARGIN, Math.max(PANEL_MARGIN, Math.round(pos.left))),
    top: Math.min(window.innerHeight - 56 - PANEL_MARGIN, Math.max(PANEL_MARGIN, Math.round(pos.top))),
  };
}

function stopStreamingMessages(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((message) => (
    message.role === "assistant" && message.isStreaming
      ? { ...message, isStreaming: false }
      : message
  ));
}

function taskSectionTitle(taskType: string): string {
  if (taskType === "generate_summary") return "agent_task_section_summary";
  if (taskType === "generate_chapter") return "agent_task_section_chapter";
  if (taskType === "revise_chapter") return "agent_task_section_revise";
  if (taskType === "append_chapter") return "agent_task_section_append";
  return "agent_task_section_content";
}

function isTaskIntroChunk(content: string): boolean {
  return /^\s*#{1,4}\s*(章节摘要|正文草稿|改写草稿|续写草稿|生成内容)\s*$/m.test(content);
}

function stopAgentSteps(steps: SseAgentStepData[]): SseAgentStepData[] {
  const next = [...steps];
  const latestPhase = new Map<string, SseAgentStepData>();
  for (const step of steps) {
    if (step.step_type === "phase" && step.phase_id) latestPhase.set(step.phase_id, step);
  }
  for (const phase of latestPhase.values()) {
    if (phase.phase_status === "running" && phase.phase_id) {
      next.push({
        step_type: "phase",
        phase_id: phase.phase_id,
        phase_status: "cancelled",
        phase_title: phase.phase_title,
        phase_detail: "已停止",
        is_parallel: false,
        ts: Date.now(),
      });
    }
  }
  next.push({ step_type: "finish", thought: "cancelled", is_parallel: false, ts: Date.now() });
  return next;
}

function finishUserConfirmStep(steps: SseAgentStepData[]): SseAgentStepData[] {
  const hasRunningConfirm = steps.some(
    (step) => step.step_type === "phase"
      && step.phase_id === "user_confirm"
      && step.phase_status === "running",
  );
  if (!hasRunningConfirm) return steps;
  return [
    ...steps,
    {
      step_type: "phase" as const,
      phase_id: "user_confirm",
      phase_status: "done" as const,
      phase_title: "用户确认",
      is_parallel: false,
      ts: Date.now(),
    },
  ];
}

function sanitizeAssistantContent(content: string): string {
  return content
    .replace(/[（(]\s*章节\s*ID\s*[:：]\s*\d+\s*[）)]/gi, "")
    .replace(/章节\s*ID\s*[:：]\s*\d+/gi, "")
    .replace(/[（(]\s*chapter\s*id\s*[:：]\s*\d+\s*[）)]/gi, "")
    .replace(/chapter\s*id\s*[:：]\s*\d+/gi, "")
    .replace(/\s+([！!。,.，])/g, "$1");
}

const ACTIVITY_TOOL_LABELS: Record<string, string> = {
  get_novel_state: "agent_activity_tool_get_novel_state",
  get_chapters: "agent_activity_tool_get_chapters",
  get_chapter_detail: "agent_activity_tool_get_chapter_detail",
  get_characters: "agent_activity_tool_get_characters",
  get_memos: "agent_activity_tool_get_memos",
  get_writing_context_pack: "agent_activity_tool_get_writing_context_pack",
  dispatch_generation_task: "agent_activity_tool_dispatch_generation_task",
  poll_task_result: "agent_activity_tool_poll_task_result",
  poll_multiple_tasks: "agent_activity_tool_poll_task_result",
  quality_check_chapter: "agent_activity_tool_quality_check_chapter",
  save_chapter: "agent_activity_tool_save_chapter",
  delete_chapter: "agent_activity_tool_delete_chapter",
  ask_user: "agent_activity_tool_ask_user",
};

const ACTIVITY_PHASE_LABELS: Record<string, string> = {
  read_context: "agent_activity_phase_read_context",
  chapter_summary: "agent_activity_phase_chapter_summary",
  chapter_content: "agent_activity_phase_chapter_content",
  quality_check: "agent_activity_phase_quality_check",
  save_chapter: "agent_activity_phase_save_chapter",
};

function cleanAgentToolName(raw: string): string {
  return raw
    .replace(/^mcp__inkmind__/, "")
    .replace(/^mcp_+inkmind_+/, "")
    .replace(/^InkMind::/, "");
}

function isInternalAgentTool(name: string): boolean {
  return /^tool_[a-f0-9_]+$/.test(name) || name === "agent_connect" || name === "agent_query";
}

function getAgentActivityLabel(steps: SseAgentStepData[], t: (key: string) => string): string {
  const latestPhases = new Map<string, SseAgentStepData>();
  const runningTools = new Map<string, number>();
  let latestGenerating = false;
  let latestEvaluating = false;

  for (const step of steps) {
    if (step.step_type === "phase" && step.phase_id) {
      latestPhases.set(step.phase_id, step);
    } else if (step.step_type === "tool_call") {
      const name = cleanAgentToolName(step.tool_name || "");
      if (name && !isInternalAgentTool(name)) {
        runningTools.set(name, (runningTools.get(name) || 0) + 1);
      }
      latestGenerating = false;
      latestEvaluating = false;
    } else if (step.step_type === "tool_result") {
      const name = cleanAgentToolName(step.tool_name || "");
      const count = runningTools.get(name) || 0;
      if (count <= 1) runningTools.delete(name);
      else runningTools.set(name, count - 1);
      latestGenerating = false;
      latestEvaluating = false;
    } else if (step.step_type === "generating") {
      latestGenerating = true;
      latestEvaluating = false;
    } else if (step.step_type === "evaluating") {
      latestEvaluating = true;
      latestGenerating = false;
    } else if (step.step_type === "finish") {
      runningTools.clear();
      latestGenerating = false;
      latestEvaluating = false;
    }
  }

  const activePhase = [...latestPhases.values()].find(
    (step) => step.phase_status === "running" && step.phase_id !== "user_confirm",
  );
  if (activePhase?.phase_id) {
    return t(ACTIVITY_PHASE_LABELS[activePhase.phase_id] || "agent_activity_working");
  }
  if (latestGenerating) return t("agent_activity_generating");
  if (latestEvaluating) return t("agent_activity_evaluating");
  const runningTool = [...runningTools.keys()].at(-1);
  if (runningTool) {
    return t(ACTIVITY_TOOL_LABELS[runningTool] || "agent_activity_using_named_tool")
      .replace("{tool}", runningTool);
  }
  return t("agent_activity_thinking");
}

function AiAssistantMark({ className = "" }: { className?: string }) {
  return (
    <span className={`ai-assistant-mark ${className}`} aria-hidden="true">
      <svg className="ai-assistant-mark__glyph" viewBox="0 0 24 24" focusable="false">
        <path d="M7.3 8.4h9.4c1 0 1.8.8 1.8 1.8v5.6c0 1-.8 1.8-1.8 1.8H7.3c-1 0-1.8-.8-1.8-1.8v-5.6c0-1 .8-1.8 1.8-1.8Z" />
        <path d="M12 8.2V5.5m-2 0h4" />
        <circle cx="9.6" cy="12.7" r="1.2" />
        <circle cx="14.4" cy="12.7" r="1.2" />
      </svg>
    </span>
  );
}

function AgentActivityIndicator({ label }: { label: string }) {
  return (
    <div className="agent-activity" aria-live="polite">
      <span className="agent-activity__orb" aria-hidden="true" />
      <span className="agent-activity__text">{label}</span>
      <span className="agent-activity__dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}

export default function AiAssistantFloating({ novelId }: AiAssistantFloatingProps) {
  const { t } = useI18n();

  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();
  const writingPage = /\/novels\/\d+\/write$/.test(location.pathname);
  const managementPage = /\/novels\/\d+\/(settings|people|memos)(\/|$)/.test(location.pathname);
  const [dockTarget, setDockTarget] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const syncDock = () => setDockTarget(writingPage ? document.getElementById("write-assistant-dock") : null);
    syncDock();
    window.addEventListener("inkmind:assistant-dock-ready", syncDock);
    return () => window.removeEventListener("inkmind:assistant-dock-ready", syncDock);
  }, [writingPage, novelId]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("inkmind:assistant-visibility", { detail: { open: isOpen } }));
  }, [isOpen, location.pathname]);
  useEffect(() => {
    const minimize = () => setIsOpen(false);
    window.addEventListener("inkmind:assistant-minimize", minimize);
    return () => window.removeEventListener("inkmind:assistant-minimize", minimize);
  }, []);
  const [novels, setNovels] = useState<Novel[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [selectedNovelId, setSelectedNovelId] = useState<number | undefined>(novelId);
  const [session, setSession] = useState<AgentSession | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [agentSteps, setAgentSteps] = useState<SseAgentStepData[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestionData | null>(null);
  const [status, setStatus] = useState<string>("idle");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const activeAssistantIdRef = useRef<string>("");
  const activeRunIdRef = useRef(0);
  const activeAbortRef = useRef<AbortController | null>(null);
  const activeCloseRef = useRef<(() => void) | null>(null);
  const answeringQuestionRef = useRef(false);
  const lastAgentPromptRef = useRef("");
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    startRect: PanelRect;
    mode: PanelResizeMode;
  } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; startRect: PanelRect } | null>(null);
  const iconDragRef = useRef<{ startX: number; startY: number; startPos: IconPos; moved: boolean } | null>(null);
  const [panelRect, setPanelRect] = useState<PanelRect>(() => clampPanelRect(loadJson(PANEL_RECT_KEY, defaultPanelRect())));
  const [iconPos, setIconPos] = useState<IconPos>(() => clampIconPos(loadJson(ICON_POS_KEY, defaultIconPos())));
  const [isPanelResizing, setIsPanelResizing] = useState(false);
  const [isPanelDragging, setIsPanelDragging] = useState(false);
  const [isIconDragging, setIsIconDragging] = useState(false);
  const [isWorkMenuOpen, setIsWorkMenuOpen] = useState(false);
  const [isUploadMenuOpen, setIsUploadMenuOpen] = useState(false);
  const [isChapterMenuOpen, setIsChapterMenuOpen] = useState(false);
  const [editorSelection, setEditorSelection] = useState<EditorSelectionContext | null>(null);
  const activeNovelId = selectedNovelId ?? novelId;
  const activeNovel = novels.find((item) => item.id === activeNovelId);
  const activeNovelTitle = activeNovel?.title || (activeNovelId ? t("common_untitled") : t("agent_select_work"));

  const resizeInputTextarea = useCallback((target?: HTMLTextAreaElement | null) => {
    const textarea = target ?? inputRef.current;
    if (!textarea) return;
    const maxHeight = Math.min(260, Math.max(118, Math.floor(window.innerHeight * 0.36)));
    textarea.style.height = "auto";
    textarea.style.overflowY = "hidden";
    const nextHeight = Math.min(maxHeight, Math.max(32, textarea.scrollHeight));
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
    if (textarea.scrollHeight <= maxHeight) textarea.scrollTop = 0;
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;
    resizeInputTextarea();
  }, [input, isOpen, panelRect.width, resizeInputTextarea]);

  useEffect(() => {
    if (!isOpen) return;
    const handleWindowResize = () => resizeInputTextarea();
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [isOpen, resizeInputTextarea]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, agentSteps]);

  useEffect(() => {
    if (!isWorkMenuOpen && !isUploadMenuOpen && !isChapterMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (composerRef.current?.contains(event.target as Node)) return;
      setIsWorkMenuOpen(false);
      setIsUploadMenuOpen(false);
      setIsChapterMenuOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [isWorkMenuOpen, isUploadMenuOpen, isChapterMenuOpen]);

  useEffect(() => {
    const handleSelection = (event: Event) => {
      const detail = (event as CustomEvent<EditorSelectionContext>).detail;
      if (!detail || detail.novelId !== activeNovelId || !detail.text?.trim()) {
        setEditorSelection(null);
        return;
      }
      setEditorSelection(detail);
      setIsUploadMenuOpen(false);
      setIsWorkMenuOpen(false);
      setIsChapterMenuOpen(false);
    };
    window.addEventListener("inkmind:editor-selection", handleSelection);
    return () => window.removeEventListener("inkmind:editor-selection", handleSelection);
  }, [activeNovelId]);

  useEffect(() => {
    setSelectedNovelId(novelId);
  }, [novelId]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetchNovels()
      .then((list) => {
        if (cancelled) return;
        setNovels(list);
        if (!novelId && !selectedNovelId && list[0]?.id) {
          setSelectedNovelId(list[0].id);
        }
      })
      .catch(() => {
        if (!cancelled) setNovels([]);
      });
    return () => { cancelled = true; };
  }, [isOpen, novelId, selectedNovelId]);

  useEffect(() => {
    if (!isOpen || !activeNovelId) return;
    let cancelled = false;
    fetchChapters(activeNovelId)
      .then((list) => {
        if (!cancelled) setChapters(list);
      })
      .catch(() => {
        if (!cancelled) setChapters([]);
      });
    return () => { cancelled = true; };
  }, [isOpen, activeNovelId]);

  useEffect(() => {
    document.body.classList.toggle("ai-assistant-is-resizing", isPanelResizing);
    if (!isPanelResizing) return;

    const handleMove = (event: PointerEvent) => {
      if (!resizeRef.current) return;
      const { startX, startY, startRect, mode } = resizeRef.current;
      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;
      if (mode === "left") {
        setPanelRect(clampPanelRect({
          ...startRect,
          left: startRect.left + deltaX,
          width: startRect.width - deltaX,
        }));
      } else if (mode === "se") {
        setPanelRect(clampPanelRect({
          ...startRect,
          width: startRect.width + deltaX,
          height: startRect.height + deltaY,
        }));
      } else if (mode === "sw") {
        setPanelRect(clampPanelRect({
          ...startRect,
          left: startRect.left + deltaX,
          width: startRect.width - deltaX,
          height: startRect.height + deltaY,
        }));
      } else if (mode === "ne") {
        setPanelRect(clampPanelRect({
          ...startRect,
          top: startRect.top + deltaY,
          width: startRect.width + deltaX,
          height: startRect.height - deltaY,
        }));
      } else {
        setPanelRect(clampPanelRect({
          ...startRect,
          left: startRect.left + deltaX,
          top: startRect.top + deltaY,
          width: startRect.width - deltaX,
          height: startRect.height - deltaY,
        }));
      }
    };

    const handleUp = () => {
      setIsPanelResizing(false);
      resizeRef.current = null;
      setPanelRect((current) => {
        const next = clampPanelRect(current);
        saveJson(PANEL_WIDTH_KEY, next.width);
        saveJson(PANEL_RECT_KEY, next);
        return next;
      });
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      document.body.classList.remove("ai-assistant-is-resizing");
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [isPanelResizing]);

  useEffect(() => {
    document.body.classList.toggle("ai-assistant-is-dragging", isPanelDragging);
    if (!isPanelDragging) return;

    const handleMove = (event: PointerEvent) => {
      if (!dragRef.current) return;
      const { startX, startY, startRect } = dragRef.current;
      setPanelRect(clampPanelRect({
        ...startRect,
        left: startRect.left + event.clientX - startX,
        top: startRect.top + event.clientY - startY,
      }));
    };

    const handleUp = () => {
      setIsPanelDragging(false);
      dragRef.current = null;
      setPanelRect((current) => {
        const next = clampPanelRect(current);
        saveJson(PANEL_RECT_KEY, next);
        return next;
      });
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      document.body.classList.remove("ai-assistant-is-dragging");
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [isPanelDragging]);

  useEffect(() => {
    document.body.classList.toggle("ai-assistant-is-dragging", isIconDragging);
    if (!isIconDragging) return;

    const handleMove = (event: PointerEvent) => {
      if (!iconDragRef.current) return;
      const deltaX = event.clientX - iconDragRef.current.startX;
      const deltaY = event.clientY - iconDragRef.current.startY;
      if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
        iconDragRef.current.moved = true;
      }
      setIconPos(clampIconPos({
        left: iconDragRef.current.startPos.left + deltaX,
        top: iconDragRef.current.startPos.top + deltaY,
      }));
    };

    const handleUp = () => {
      const moved = iconDragRef.current?.moved ?? false;
      setIsIconDragging(false);
      iconDragRef.current = null;
      setIconPos((current) => {
        const next = clampIconPos(current);
        saveJson(ICON_POS_KEY, next);
        return next;
      });
      if (!moved) setIsOpen(true);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      document.body.classList.remove("ai-assistant-is-dragging");
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [isIconDragging]);

  useEffect(() => {
    const handleResize = () => {
      setPanelRect((current) => clampPanelRect(current));
      setIconPos((current) => clampIconPos(current));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ novelId?: number; prompt?: string }>).detail;
      if (detail?.novelId && novelId && detail.novelId !== novelId) return;
      if (detail?.novelId && !novelId) setSelectedNovelId(detail.novelId);
      setIsOpen(true);
      if (detail?.prompt) {
        setInput(detail.prompt);
      }
      window.setTimeout(() => inputRef.current?.focus(), 0);
    };
    window.addEventListener("inkmind:assistant-open", handleOpen);
    return () => window.removeEventListener("inkmind:assistant-open", handleOpen);
  }, [novelId]);

  useEffect(() => {
    if (!isOpen || !activeNovelId) return;
    const stored = loadJson<{ session_id: string; novel_id: number } | null>(`${SESSION_KEY}_${activeNovelId}`, null);
    setSession(stored?.session_id && stored.novel_id === activeNovelId ? stored as AgentSession : null);
    setMessages([]);
    setAgentSteps([]);
    setPendingQuestion(null);
    setAttachments([]);
    setEditorSelection((selection) => selection?.novelId === activeNovelId ? selection : null);
    setStatus("idle");
  }, [isOpen, activeNovelId]);

  const ensureSession = useCallback(async () => {
    if (session) return session;
    return await createNewSession();
  }, [session, activeNovelId]);

  const createNewSession = useCallback(async () => {
    const s = await createAgentSession(activeNovelId!);
    setSession(s);
    saveJson(`${SESSION_KEY}_${activeNovelId}`, s);
    return s;
  }, [activeNovelId]);

  const resetSession = useCallback(() => {
    setSession(null);
    try { localStorage.removeItem(`${SESSION_KEY}_${activeNovelId}`); } catch { /* ignore */ }
  }, [activeNovelId]);

  const focusComposer = useCallback(() => {
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const applyRecoveryPrompt = useCallback((mode: "retry" | "short" | "background") => {
    const lastPrompt = lastAgentPromptRef.current.trim();
    if (mode === "retry") {
      setInput(lastPrompt);
    } else if (mode === "short") {
      setInput(
        t("agent_recovery_short_prompt").replace("{prompt}", lastPrompt || t("agent_recovery_last_task")),
      );
    } else {
      setInput(
        t("agent_recovery_background_prompt").replace("{prompt}", lastPrompt || t("agent_recovery_last_task")),
      );
    }
    focusComposer();
  }, [focusComposer, t]);

  const recoveryActions = useCallback((): ActionButton[] => ([
    {
      label: t("agent_recovery_retry"),
      type: "primary",
      action: () => applyRecoveryPrompt("retry"),
    },
    {
      label: t("agent_recovery_shorter"),
      type: "default",
      action: () => applyRecoveryPrompt("short"),
    },
    {
      label: t("agent_recovery_background"),
      type: "default",
      action: () => applyRecoveryPrompt("background"),
    },
  ]), [applyRecoveryPrompt, t]);

  const addRecoverableErrorMessage = useCallback((content: string) => {
    setMessages((prev) => [
      ...stopStreamingMessages(prev),
      {
        id: generateId(),
        role: "error",
        content,
        timestamp: Date.now(),
        actionButtons: recoveryActions(),
      },
    ]);
  }, [recoveryActions]);

  const buildChatHandlers = useCallback((aid: string, runId: number) => {
    activeAssistantIdRef.current = aid;
    const isStaleRun = () => activeRunIdRef.current !== runId;
    return {
      onPatch: (data: any) => {
        if (isStaleRun()) return;
        if (data.message?.role === "assistant") {
          const currentAid = activeAssistantIdRef.current;
          setMessages((prev) => prev.map((m) => m.id === currentAid ? { ...m, content: data.message?.content || "", isStreaming: data.message?.is_streaming } : m));
        }
      },
      onDelta: (data: any) => {
        if (isStaleRun()) return;
        if (data.type === "task_text" && data.content) {
          const currentAid = activeAssistantIdRef.current;
          const taskId = data.task_id || "task";
          const taskType = data.task_type || "content";
          const chunk = isTaskIntroChunk(data.content) ? "" : data.content;
          setMessages((prev) => prev.map((m) => {
            if (m.id !== currentAid) return m;
            const sections = [...(m.taskSections || [])];
            const idx = sections.findIndex((section) => section.taskId === taskId);
            if (idx >= 0) {
              const current = sections[idx];
              sections[idx] = {
                ...current,
                content: current.content + chunk,
                draftContent: current.editing ? current.draftContent : undefined,
                saved: false,
              };
            } else {
              sections.push({
                taskId,
                taskType,
                title: taskSectionTitle(taskType),
                content: chunk,
                collapsed: false,
              });
            }
            return { ...m, taskSections: sections };
          }));
        } else if (data.type === "text" && data.content) {
          const currentAid = activeAssistantIdRef.current;
          setMessages((prev) => prev.map((m) => {
            if (m.id !== currentAid) return m;
            if (m.taskSections?.length) {
              return { ...m, postTaskContent: (m.postTaskContent || "") + data.content };
            }
            return { ...m, content: m.content + data.content };
          }));
        }
      },
      onAgentStep: (data: any) => {
        if (isStaleRun()) return;
        if (
          answeringQuestionRef.current
          && data.step_type === "phase"
          && data.phase_id === "user_confirm"
          && data.phase_status === "running"
        ) {
          return;
        }
        console.log("[AgentStep]", data.step_type, data.tool_name);
        setAgentSteps((prev) => [...prev, data]);
      },
      onQuestion: (data: any) => {
        if (isStaleRun()) return;
        answeringQuestionRef.current = false;
        console.log("[Question]", data.question, data.options);
        setMessages((prev) => stopStreamingMessages(prev));
        setPendingQuestion(data);
      },
      onChapterSaved: (data: any) => {
        if (isStaleRun()) return;
        console.log("[ChapterSaved]", data.id, data.title);
        setMessages((prev) => [
          ...stopStreamingMessages(prev),
          {
            id: generateId(),
            role: "chapter_saved",
            content: "",
            timestamp: Date.now(),
            savedChapter: data,
          },
        ]);
        window.dispatchEvent(new CustomEvent("inkmind:chapter-saved", { detail: data }));
      },
      onChapterDeleted: (data: any) => {
        if (isStaleRun()) return;
        console.log("[ChapterDeleted]", data.id, data.title);
        window.dispatchEvent(new CustomEvent("inkmind:chapter-deleted", { detail: data }));
      },
      onStatus: (data: any) => {
        if (isStaleRun()) return;
        const s = data.status || "idle";
        if (s === "waiting_for_user" && answeringQuestionRef.current) return;
        setStatus(s);
        if (s === "waiting_for_user") {
          setMessages((prev) => stopStreamingMessages(prev));
          setIsLoading(false);
          activeAbortRef.current = null;
          activeCloseRef.current = null;
        } else if (s === "idle") {
          answeringQuestionRef.current = false;
          setMessages((prev) => stopStreamingMessages(prev));
          setIsLoading(false);
          activeAbortRef.current = null;
          activeCloseRef.current = null;
        }
      },
      onDone: () => {
        if (isStaleRun()) return;
        answeringQuestionRef.current = false;
        setMessages((prev) => stopStreamingMessages(prev));
        setAgentSteps((prev) => [...prev, { step_type: "finish" as const, is_parallel: false, ts: Date.now() }]);
        setIsLoading(false);
        activeAbortRef.current = null;
        activeCloseRef.current = null;
      },
      onError: (data: any) => {
        if (isStaleRun()) return;
        answeringQuestionRef.current = false;
        addRecoverableErrorMessage(data.message || t("agent_task_failed"));
        setIsLoading(false);
        activeAbortRef.current = null;
        activeCloseRef.current = null;
      },
    };
  }, [addRecoverableErrorMessage, t]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0 && !editorSelection?.text.trim()) || isLoading || !activeNovelId) return;
    const messageAttachments = attachments;
    const messageSelection = editorSelection?.text.trim() ? editorSelection : null;
    const messageForAgent = buildAttachmentPrompt(
      buildEditorSelectionPrompt(text, messageSelection),
      messageAttachments,
    );
    const displayText = text || (messageSelection ? t("agent_selection_user_message") : t("agent_attachment_user_message"));
    lastAgentPromptRef.current = messageForAgent;

    setInput("");
    setAttachments([]);
    setIsLoading(true);
    setPendingQuestion(null);
    setAgentSteps([]);
    answeringQuestionRef.current = false;
    const runId = activeRunIdRef.current + 1;
    activeRunIdRef.current = runId;

    setMessages((prev) => [...stopStreamingMessages(prev), {
      id: generateId(),
      role: "user",
      content: displayText,
      attachments: messageAttachments,
      selectionContext: messageSelection ?? undefined,
      timestamp: Date.now(),
    }]);

    try {
      const cur = await ensureSession();
      if (activeRunIdRef.current !== runId) return;
      const aid = generateId();
      setMessages((prev) => [...prev, { id: aid, role: "assistant", content: "", timestamp: Date.now(), isStreaming: true }]);

      const handlers = buildChatHandlers(aid, runId);
      const retryOnError: typeof handlers = {
        ...handlers,
        onError: async (data: any) => {
          if (activeRunIdRef.current !== runId) return;
          const msg = data.message || "";
          if (msg.includes("会话不存在") || msg.includes("not found")) {
            resetSession();
	            try {
	              const newSess = await createNewSession();
                if (activeRunIdRef.current !== runId) return;
	              const retryHandlers = buildChatHandlers(aid, runId);
	              const retryController = new AbortController();
	              activeAbortRef.current = retryController;
	              const retryConn = await agentChat(activeNovelId, newSess.session_id, messageForAgent, retryHandlers, { signal: retryController.signal });
                if (activeRunIdRef.current !== runId) {
                  retryConn.close();
                  return;
                }
	              activeCloseRef.current = retryConn.close;
	            } catch {
                if (activeRunIdRef.current !== runId) return;
	              addRecoverableErrorMessage(t("agent_session_recreate_failed"));
	              setIsLoading(false);
            }
          } else {
            handlers.onError(data);
          }
        },
	      };

	      const controller = new AbortController();
	      activeAbortRef.current = controller;
	      const conn = await agentChat(activeNovelId, cur.session_id, messageForAgent, retryOnError, { signal: controller.signal });
        if (activeRunIdRef.current !== runId) {
          conn.close();
          return;
        }
	      activeCloseRef.current = conn.close;
	    } catch (err) {
      if (activeRunIdRef.current !== runId) return;
      addRecoverableErrorMessage(err instanceof Error ? err.message : t("agent_connection_failed"));
      setIsLoading(false);
    }
  }, [input, attachments, editorSelection, isLoading, activeNovelId, ensureSession, resetSession, createNewSession, buildChatHandlers, addRecoverableErrorMessage, t]);

  const handleInterrupt = useCallback(async () => {
    if (!isLoading || !activeNovelId || !session) return;
    activeRunIdRef.current += 1;
    activeCloseRef.current?.();
    activeAbortRef.current?.abort();
    activeCloseRef.current = null;
    activeAbortRef.current = null;
    answeringQuestionRef.current = false;
    setIsLoading(false);
    setPendingQuestion(null);
    setStatus("idle");
    setAgentSteps((prev) => stopAgentSteps(prev));
    setMessages((prev) => [
      ...stopStreamingMessages(prev),
      { id: generateId(), role: "system", content: t("agent_interrupted"), timestamp: Date.now() },
    ]);
    try {
      await interruptAgentSession(activeNovelId, session.session_id);
    } catch (err) {
      setMessages((prev) => [...prev, {
        id: generateId(),
        role: "error",
        content: err instanceof Error ? err.message : t("agent_interrupt_failed"),
        timestamp: Date.now(),
      }]);
    }
  }, [isLoading, activeNovelId, session, t]);

  const handleAnswerQuestion = useCallback(async (questionId: string, answer: string, selectedOption?: string) => {
    if (!session || !pendingQuestion || !activeNovelId) return;
    setPendingQuestion(null);
    setIsLoading(true);
    setStatus("running");
    answeringQuestionRef.current = true;
    setAgentSteps((prev) => finishUserConfirmStep(prev));
    const answerText = selectedOption || answer;
    const runId = activeRunIdRef.current;

    const newAid = generateId();
    activeAssistantIdRef.current = newAid;
    setMessages((prev) => [
      ...stopStreamingMessages(prev),
      { id: generateId(), role: "user", content: answerText, timestamp: Date.now() },
      { id: newAid, role: "assistant", content: "", timestamp: Date.now(), isStreaming: true },
    ]);

    try {
	      const result = await agentAnswerQuestion(activeNovelId!, session.session_id, questionId, answer, selectedOption);
        if (activeRunIdRef.current !== runId) return;
	      if (!result.resolved) {
          const fallbackRunId = activeRunIdRef.current + 1;
          activeRunIdRef.current = fallbackRunId;
	        const handlers = buildChatHandlers(newAid, fallbackRunId);
	        const controller = new AbortController();
	        activeAbortRef.current = controller;
	        const conn = await agentChat(activeNovelId!, session.session_id, answerText, handlers, { signal: controller.signal });
          if (activeRunIdRef.current !== fallbackRunId) {
            conn.close();
            return;
          }
	        activeCloseRef.current = conn.close;
	      }
    } catch (err) {
      if (activeRunIdRef.current !== runId) return;
      addRecoverableErrorMessage(err instanceof Error ? err.message : t("agent_connection_failed"));
      setIsLoading(false);
    }
  }, [session, pendingQuestion, activeNovelId, buildChatHandlers, addRecoverableErrorMessage, t]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  const handleOpenSavedChapter = useCallback((chapter: SseChapterSavedData) => {
    window.dispatchEvent(new CustomEvent("inkmind:chapter-saved", { detail: chapter }));
  }, []);

  const updateTaskSection = useCallback((
    messageId: string,
    taskId: string,
    updater: (section: AgentTaskSection) => AgentTaskSection,
  ) => {
    setMessages((prev) => prev.map((message) => {
      if (message.id !== messageId || !message.taskSections) return message;
      return {
        ...message,
        taskSections: message.taskSections.map((section) => (
          section.taskId === taskId ? updater(section) : section
        )),
      };
    }));
  }, []);

  const handleToggleTaskSection = useCallback((messageId: string, taskId: string) => {
    updateTaskSection(messageId, taskId, (section) => ({ ...section, collapsed: !section.collapsed }));
  }, [updateTaskSection]);

  const handleEditTaskSection = useCallback((messageId: string, taskId: string) => {
    updateTaskSection(messageId, taskId, (section) => ({
      ...section,
      editing: true,
      collapsed: false,
      draftContent: section.content,
      saved: false,
    }));
  }, [updateTaskSection]);

  const handleCancelTaskSectionEdit = useCallback((messageId: string, taskId: string) => {
    updateTaskSection(messageId, taskId, (section) => ({
      ...section,
      editing: false,
      draftContent: undefined,
      saving: false,
    }));
  }, [updateTaskSection]);

  const handleTaskSectionDraftChange = useCallback((messageId: string, taskId: string, value: string) => {
    updateTaskSection(messageId, taskId, (section) => ({ ...section, draftContent: value, saved: false }));
  }, [updateTaskSection]);

  const handleApplyTaskSectionEdit = useCallback(async (messageId: string, section: AgentTaskSection) => {
    if (!activeNovelId || !session) return;
    const content = (section.draftContent ?? section.content).trim();
    updateTaskSection(messageId, section.taskId, (current) => ({ ...current, saving: true }));
    try {
      await updateAgentTaskOutput(activeNovelId, session.session_id, section.taskId, section.taskType, content);
      updateTaskSection(messageId, section.taskId, (current) => ({
        ...current,
        content,
        draftContent: undefined,
        editing: false,
        saving: false,
        saved: true,
      }));
    } catch (err) {
      updateTaskSection(messageId, section.taskId, (current) => ({ ...current, saving: false }));
      setMessages((prev) => [...prev, {
        id: generateId(),
        role: "error",
        content: err instanceof Error ? err.message : t("agent_task_section_apply_failed"),
        timestamp: Date.now(),
      }]);
    }
  }, [activeNovelId, session, t, updateTaskSection]);

  const handleContinueAfterSaved = useCallback(() => {
    setInput(t("smart_writer_suggestion_1"));
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [t]);

  const handleSuggestionClick = useCallback((prompt: string) => {
    if (isLoading) return;
    setInput(prompt);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [isLoading]);

  const handleNewConversation = useCallback(async () => {
    if (!activeNovelId) return;
    const sessionToInterrupt = session;
    activeRunIdRef.current += 1;
    activeCloseRef.current?.();
    activeAbortRef.current?.abort();
    activeCloseRef.current = null;
    activeAbortRef.current = null;
    answeringQuestionRef.current = false;
    setIsLoading(false);
    setPendingQuestion(null);
    setAgentSteps([]);
    setMessages([]);
    setInput("");
    setAttachments([]);
    setEditorSelection(null);
    setStatus("idle");
    setSession(null);
    try { localStorage.removeItem(`${SESSION_KEY}_${activeNovelId}`); } catch { /* ignore */ }
    if (sessionToInterrupt) {
      try { await interruptAgentSession(activeNovelId, sessionToInterrupt.session_id); } catch { /* ignore */ }
    }
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [activeNovelId, session]);

  const handleNovelSelect = useCallback((nextId: number) => {
    if (!Number.isFinite(nextId) || isLoading) return;
    setSelectedNovelId(nextId);
    setIsWorkMenuOpen(false);
    setIsUploadMenuOpen(false);
    setIsChapterMenuOpen(false);
    setEditorSelection(null);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [isLoading]);

  const handleToggleWorkMenu = useCallback(() => {
    if (isLoading || novels.length === 0) return;
    setIsUploadMenuOpen(false);
    setIsChapterMenuOpen(false);
    setIsWorkMenuOpen((open) => !open);
  }, [isLoading, novels.length]);

  const handleToggleUploadMenu = useCallback(() => {
    if (isLoading) return;
    setIsWorkMenuOpen(false);
    setIsChapterMenuOpen(false);
    setIsUploadMenuOpen((open) => !open);
  }, [isLoading]);

  const handleOpenFilePicker = useCallback(() => {
    setIsUploadMenuOpen(false);
    setIsChapterMenuOpen(false);
    fileInputRef.current?.click();
  }, []);

  const handleOpenChapterMenu = useCallback(() => {
    setIsUploadMenuOpen(false);
    setIsWorkMenuOpen(false);
    setIsChapterMenuOpen(true);
  }, []);

  const handleAddChapterContext = useCallback((chapter: Chapter, index: number) => {
    const title = `${t("write_chapter_n")}${index + 1}${t("write_chapter_n_suffix")}${chapter.title?.trim() ? ` ${chapter.title.trim()}` : ""}`;
    const body = [
      chapter.summary?.trim() ? `概要：${chapter.summary.trim()}` : "",
      chapter.content?.trim() ? `正文：\n${chapter.content.trim()}` : "",
    ].filter(Boolean).join("\n\n");
    setAttachments((prev) => {
      if (prev.some((item) => item.kind === "chapter" && item.chapterId === chapter.id)) return prev;
      return [...prev, {
        id: generateId(),
        kind: "chapter" as const,
        chapterId: chapter.id,
        name: title,
        size: body.length,
        type: "chapter/context",
        content: body,
        truncated: false,
      }].slice(0, 8);
    });
    setIsChapterMenuOpen(false);
    setInput((current) => current.replace(/@\s*$/, ""));
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [t]);

  const handleUploadFiles = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;

    const nextAttachments = await Promise.all(files.map(async (file) => {
      const attachment: UploadedAttachment = {
        id: generateId(),
        kind: "file",
        name: file.name,
        size: file.size,
        type: file.type,
      };
      if (!isLikelyTextFile(file)) return attachment;
      try {
        const raw = await file.text();
        return {
          ...attachment,
          content: raw.slice(0, MAX_ATTACHMENT_CHARS),
          truncated: raw.length > MAX_ATTACHMENT_CHARS,
        };
      } catch {
        return attachment;
      }
    }));

    setAttachments((prev) => [...prev, ...nextAttachments].slice(0, 6));
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((file) => file.id !== id));
  }, []);

  const shouldOpenChapterMenuFromInput = useCallback((value: string, cursor: number) => {
    const index = Math.max(0, Math.min(value.length, cursor) - 1);
    return value[index] === "@" || value.endsWith("@");
  }, []);

  const handleInputChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setInput(value);
    resizeInputTextarea(event.target);
    const cursor = event.target.selectionStart;
    if (shouldOpenChapterMenuFromInput(value, cursor)) {
      setIsUploadMenuOpen(false);
      setIsWorkMenuOpen(false);
      setIsChapterMenuOpen(true);
    }
  }, [resizeInputTextarea, shouldOpenChapterMenuFromInput]);

  const handleInputKeyUp = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const value = event.currentTarget.value;
    const cursor = event.currentTarget.selectionStart;
    if (event.key === "@" || shouldOpenChapterMenuFromInput(value, cursor)) {
      setIsUploadMenuOpen(false);
      setIsWorkMenuOpen(false);
      setIsChapterMenuOpen(true);
    }
  }, [shouldOpenChapterMenuFromInput]);

  const handlePanelResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>, mode: PanelResizeMode) => {
    if (dockTarget && window.innerWidth >= 1180) return;
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = { startX: event.clientX, startY: event.clientY, startRect: panelRect, mode };
    setIsPanelResizing(true);
  }, [panelRect, dockTarget]);

  const handlePanelDragStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dockTarget && window.innerWidth >= 1180) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, textarea, input, select, label, a")) return;
    event.preventDefault();
    dragRef.current = { startX: event.clientX, startY: event.clientY, startRect: panelRect };
    setIsPanelDragging(true);
  }, [panelRect, dockTarget]);

  const handleIconPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    iconDragRef.current = { startX: event.clientX, startY: event.clientY, startPos: iconPos, moved: false };
    setIsIconDragging(true);
  }, [iconPos]);

  const activityLabel = getAgentActivityLabel(agentSteps, t);

  return (
    <>
      {!isOpen && !writingPage && !managementPage && (
        <button
          type="button"
          className={`ai-assistant-float-btn${isIconDragging ? " ai-assistant-float-btn--dragging" : ""}`}
          style={{ left: iconPos.left, top: iconPos.top }}
          onPointerDown={handleIconPointerDown}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setIsOpen(true);
            }
          }}
          title={t("smart_writer_title")}
        >
          <AiAssistantMark />
          <span className="ai-assistant-float-btn__label">{t("smart_writer_title")}</span>
        </button>
      )}

      {isOpen && createPortal(
        <div
          className={`ai-assistant-panel${isPanelResizing ? " ai-assistant-panel--resizing" : ""}${isPanelDragging ? " ai-assistant-panel--dragging" : ""}`}
          style={{
            left: panelRect.left,
            top: panelRect.top,
            width: panelRect.width,
            height: panelRect.height,
          }}
        >
          <div
            className="ai-assistant-panel__width-handle"
            onPointerDown={(event) => handlePanelResizeStart(event, "left")}
            aria-hidden="true"
          />
          {(["nw", "ne", "sw", "se"] as const).map((mode) => (
            <div
              key={mode}
              className={`ai-assistant-panel__resize ai-assistant-panel__resize--${mode}`}
              onPointerDown={(event) => handlePanelResizeStart(event, mode)}
              aria-hidden="true"
            />
          ))}
          <div className="ai-assistant-header" onPointerDown={handlePanelDragStart}>
            <div className="ai-assistant-header__title">
              <AiAssistantMark className="ai-assistant-mark--header" />
              <span>{t("smart_writer_title")}</span>
              {status === "running" && <span className="ai-assistant-header__status-dot" />}
            </div>
            <div className="ai-assistant-header__actions">
              <button
                type="button"
                className="ai-assistant-icon-btn ai-assistant-icon-btn--tooltip"
                onClick={handleNewConversation}
                disabled={!activeNovelId}
                data-tooltip={t("agent_new_conversation")}
                title={t("agent_new_conversation")}
                aria-label={t("agent_new_conversation")}
              >
                <span className="ai-assistant-icon-stack" aria-hidden="true">
                  <CommentOutlined />
                  <PlusOutlined />
                </span>
              </button>
              <button type="button" className="ai-assistant-header__close" onClick={() => setIsOpen(false)} aria-label={t("common_cancel")}>
                <CloseOutlined />
              </button>
            </div>
          </div>

          {isLoading && (
            <div className="agent-running-bar" aria-live="polite">
              <AgentActivityIndicator label={activityLabel} />
              <button type="button" className="agent-running-bar__stop" onClick={handleInterrupt}>
                <span className="agent-stop-icon" aria-hidden="true" />
                <span>{t("agent_chat_stop")}</span>
              </button>
            </div>
          )}

          {agentSteps.length > 0 && (
            <div className="agent-steps-container">
              <AgentStepDisplay steps={agentSteps} />
            </div>
          )}

          <div className="agent-messages">
            {messages.length === 0 && (
              <div className="agent-welcome">
                <div className="agent-welcome__icon"><AiAssistantMark /></div>
                <div className="agent-welcome__copy">
                  <p className="agent-welcome__eyebrow">{t("smart_writer_welcome_eyebrow")}</p>
                  <p className="agent-welcome__title">{t("smart_writer_welcome_title")}</p>
                  <p className="agent-welcome__text">{t("smart_writer_welcome")}</p>
                </div>
                <div className="agent-welcome__actions" aria-label={t("smart_writer_recommended_actions")}>
                  {[
                    t("smart_writer_suggestion_1"),
                    t("smart_writer_suggestion_2"),
                    t("smart_writer_suggestion_check"),
                    t("smart_writer_suggestion_character"),
                  ].map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="agent-welcome__action"
                      disabled={isLoading}
                      onClick={() => handleSuggestionClick(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((msg) => {
              const isEmptyAssistant = msg.role === "assistant"
                && !msg.content.trim()
                && !msg.postTaskContent?.trim()
                && !(msg.taskSections?.length);
              const showAssistantActivity = msg.role === "assistant" && msg.isStreaming && isLoading && !pendingQuestion;
              if (isEmptyAssistant && !msg.isStreaming) {
                return null;
              }
              return (
              <div key={msg.id} className={`agent-message agent-message-${msg.role}`}>
                {msg.role === "user" ? (
                  <div className="agent-message-content agent-message-content--user">
                    {msg.selectionContext?.text.trim() && (
                      <div className="agent-message-selection">
                        <div className="agent-message-selection__label">
                          <FileTextOutlined />
                          <span>
                            {msg.selectionContext.chapterTitle?.trim() || t("agent_selection_reference")}
                            <span className="agent-message-selection__count">
                              {t("agent_selection_lines").replace("{count}", String(msg.selectionContext.lineCount || 1))}
                            </span>
                          </span>
                        </div>
                        <div className="agent-message-selection__text">{msg.selectionContext.text}</div>
                      </div>
                    )}
                    <div>{msg.content}</div>
                    {!!msg.attachments?.length && (
                      <div className="agent-message-attachments">
                        {msg.attachments.map((file) => (
                          <span key={file.id} className="agent-message-attachment">
                            {file.kind === "chapter" ? <FileTextOutlined /> : <PaperClipOutlined />}
                            {file.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ) : msg.role === "error" ? (
                  <div className="agent-message-content agent-message-content--error">
                    <div>{msg.content}</div>
                    {!!msg.actionButtons?.length && (
                      <div className="agent-error-actions">
                        {msg.actionButtons.map((action) => (
                          <button
                            key={action.label}
                            type="button"
                            className={`agent-error-action agent-error-action--${action.type}`}
                            onClick={action.action}
                          >
                            {action.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : msg.role === "chapter_saved" && msg.savedChapter ? (
                  <div className="agent-message-content agent-message-content--saved">
                    <div className="agent-saved-card">
                      <div className="agent-saved-card__mark" aria-hidden="true">✓</div>
                      <div className="agent-saved-card__body">
                        <div className="agent-saved-card__eyebrow">{t("agent_saved_card_label")}</div>
                        <div className="agent-saved-card__title">
                          {t("agent_saved_card_title")
                            .replace("{chapter}", String(msg.savedChapter.chapter_number || ""))
                            .replace("{title}", msg.savedChapter.title || t("common_untitled"))}
                        </div>
                        <div className="agent-saved-card__meta">
                          {t("agent_saved_card_meta").replace("{count}", String(msg.savedChapter.word_count || 0))}
                        </div>
                        <div className="agent-saved-card__actions">
                          <button type="button" onClick={() => handleOpenSavedChapter(msg.savedChapter!)}>
                            {t("agent_saved_card_open")}
                          </button>
                          <button type="button" onClick={handleContinueAfterSaved}>
                            {t("agent_saved_card_continue")}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="agent-message-content agent-message-content--assistant">
                    <div className="agent-message-avatar">
                      <AiAssistantMark className="ai-assistant-mark--avatar" />
                    </div>
	                    <div className="agent-message-body">
                        {isEmptyAssistant && msg.isStreaming ? (
                          <AgentActivityIndicator label={activityLabel} />
                        ) : msg.content.trim() && (
	                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{sanitizeAssistantContent(msg.content)}</ReactMarkdown>
	                      )}
	                      {msg.taskSections?.map((section) => (
	                        <div key={section.taskId} className={`agent-task-section${section.collapsed ? " agent-task-section--collapsed" : ""}`}>
	                          <div className="agent-task-section__header">
	                            <button
	                              type="button"
	                              className="agent-task-section__toggle"
	                              onClick={() => handleToggleTaskSection(msg.id, section.taskId)}
	                            >
	                              <span className="agent-task-section__chevron">{section.collapsed ? "›" : "⌄"}</span>
	                              <span>{t(section.title)}</span>
	                            </button>
	                            <div className="agent-task-section__meta">
	                              <span>{t("agent_task_section_word_count").replace("{count}", String(section.content.length))}</span>
	                              {section.saved && <span>{t("agent_task_section_applied")}</span>}
	                              <button type="button" onClick={() => handleEditTaskSection(msg.id, section.taskId)}>
	                                {t("common_edit")}
	                              </button>
	                            </div>
	                          </div>
	                          {!section.collapsed && (
	                            <div className="agent-task-section__body">
	                              {section.editing ? (
	                                <>
	                                  <textarea
	                                    className="agent-task-section__editor"
	                                    value={section.draftContent ?? section.content}
	                                    onChange={(event) => handleTaskSectionDraftChange(msg.id, section.taskId, event.target.value)}
	                                  />
	                                  <div className="agent-task-section__actions">
	                                    <button
	                                      type="button"
	                                      onClick={() => handleApplyTaskSectionEdit(msg.id, section)}
	                                      disabled={section.saving}
	                                    >
	                                      {section.saving ? t("agent_task_section_applying") : t("agent_task_section_apply")}
	                                    </button>
	                                    <button
	                                      type="button"
	                                      onClick={() => handleCancelTaskSectionEdit(msg.id, section.taskId)}
	                                      disabled={section.saving}
	                                    >
	                                      {t("smart_writer_action_cancel")}
	                                    </button>
	                                  </div>
	                                </>
	                              ) : (
	                                <div className="agent-task-section__content">
	                                  {section.content || (msg.isStreaming ? t("agent_task_section_generating") : "")}
	                                </div>
	                              )}
	                            </div>
	                          )}
	                        </div>
	                      ))}
                        {msg.postTaskContent?.trim() && (
                          <div className="agent-message-post-task">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{sanitizeAssistantContent(msg.postTaskContent)}</ReactMarkdown>
                          </div>
                        )}
                        {!isEmptyAssistant && showAssistantActivity && (
                          <AgentActivityIndicator label={activityLabel} />
                        )}
	                      {msg.isStreaming && msg.content.trim() && !showAssistantActivity && <span className="agent-cursor" aria-hidden="true" />}
	                    </div>
                  </div>
                )}
              </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {pendingQuestion && (
            <div className="agent-question-container">
              <AskUserQuestion question={pendingQuestion} onAnswer={handleAnswerQuestion} disabled={isLoading} />
            </div>
          )}

          <div className="agent-input-container">
            <div
              ref={composerRef}
              className={`agent-input-shell${isWorkMenuOpen || isUploadMenuOpen || isChapterMenuOpen ? " agent-input-shell--menu-open" : ""}`}
            >
              {!!attachments.length && (
                <div className="agent-attachment-list">
                  {attachments.map((file) => (
                    <span key={file.id} className="agent-attachment-chip" title={file.name}>
                      {file.kind === "chapter" ? <FileTextOutlined /> : <PaperClipOutlined />}
                      <span className="agent-attachment-chip__name">{file.name}</span>
                      {file.kind === "file" && <span className="agent-attachment-chip__size">{formatFileSize(file.size)}</span>}
                      <button
                        type="button"
                        onClick={() => handleRemoveAttachment(file.id)}
                        aria-label={t("agent_attachment_remove").replace("{name}", file.name)}
                      >
                        <CloseOutlined />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <textarea
                ref={inputRef}
                className="agent-input"
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onKeyUp={handleInputKeyUp}
                placeholder={activeNovelId ? t("agent_chat_placeholder") : t("agent_select_novel_first")}
                disabled={isLoading || !activeNovelId}
              />
              <div className="agent-input-toolbar">
                <div className="agent-context-tools">
                  <button
                    type="button"
                    className={`agent-upload-btn${isUploadMenuOpen ? " agent-upload-btn--active" : ""}`}
                    onClick={handleToggleUploadMenu}
                    disabled={isLoading}
                    title={t("agent_add_context_or_file")}
                    aria-label={t("agent_add_context_or_file")}
                    aria-expanded={isUploadMenuOpen}
                  >
                    <PlusOutlined />
                  </button>
                  <div className="agent-work-menu-wrap">
                    <button
                      type="button"
                      className={`agent-work-selector${!activeNovelId ? " agent-work-selector--empty" : ""}${isWorkMenuOpen ? " agent-work-selector--open" : ""}`}
                      onClick={handleToggleWorkMenu}
                      disabled={isLoading || novels.length === 0}
                      title={activeNovelTitle}
                      aria-label={t("agent_select_work")}
                      aria-expanded={isWorkMenuOpen}
                    >
                      <BookOutlined />
                      <span className="agent-work-selector__text">{activeNovelTitle}</span>
                      <DownOutlined className="agent-work-selector__chevron" />
                    </button>
                    {isWorkMenuOpen && (
                      <div className="agent-work-menu" role="menu" aria-label={t("agent_select_work")}>
                        <div className="agent-work-menu__label">{t("agent_select_work")}</div>
                        {novels.map((novel) => {
                          const isSelected = novel.id === activeNovelId;
                          return (
                            <button
                              key={novel.id}
                              type="button"
                              className={`agent-work-menu__item${isSelected ? " agent-work-menu__item--selected" : ""}`}
                              onClick={() => handleNovelSelect(novel.id)}
                              role="menuitemradio"
                              aria-checked={isSelected}
                            >
                              <span className="agent-work-menu__icon"><BookOutlined /></span>
                              <span className="agent-work-menu__title">{novel.title || t("common_untitled")}</span>
                              {isSelected && <CheckOutlined className="agent-work-menu__check" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {editorSelection?.text.trim() && (
                    <div className="agent-selection-context">
                      <FileTextOutlined />
                      <span>{t("agent_selection_lines").replace("{count}", String(editorSelection.lineCount || 1))}</span>
                      <button type="button" onClick={() => setEditorSelection(null)} aria-label={t("agent_selection_clear")}>
                        <CloseOutlined />
                      </button>
                    </div>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  className="agent-file-input"
                  type="file"
                  multiple
                  onChange={handleUploadFiles}
                />
                {isUploadMenuOpen && (
                  <div className="agent-upload-menu" role="menu" aria-label={t("agent_upload_file")}>
                    <button type="button" className="agent-upload-menu__item" onClick={handleOpenFilePicker} role="menuitem">
                      <UploadOutlined />
                      <span>{t("agent_upload_from_computer")}</span>
                    </button>
                    <button type="button" className="agent-upload-menu__item" onClick={handleOpenChapterMenu} role="menuitem">
                      <FileTextOutlined />
                      <span>{t("agent_add_context")}</span>
                    </button>
                  </div>
                )}
                {isChapterMenuOpen && (
                  <div className="agent-chapter-menu" role="menu" aria-label={t("agent_add_context")}>
                    <div className="agent-work-menu__label">{t("agent_context_chapters")}</div>
                    {chapters.length === 0 ? (
                      <div className="agent-context-empty">{t("agent_context_no_chapters")}</div>
                    ) : chapters.map((chapter, index) => {
                      const title = `${t("write_chapter_n")}${index + 1}${t("write_chapter_n_suffix")}${chapter.title?.trim() ? ` ${chapter.title.trim()}` : ""}`;
                      const selected = attachments.some((item) => item.kind === "chapter" && item.chapterId === chapter.id);
                      return (
                        <button
                          key={chapter.id}
                          type="button"
                          className={`agent-work-menu__item${selected ? " agent-work-menu__item--selected" : ""}`}
                          onClick={() => handleAddChapterContext(chapter, index)}
                          role="menuitemcheckbox"
                          aria-checked={selected}
                        >
                          <span className="agent-work-menu__icon"><FileTextOutlined /></span>
                          <span className="agent-work-menu__title">{title}</span>
                          {selected && <CheckOutlined className="agent-work-menu__check" />}
                        </button>
                      );
                    })}
                  </div>
                )}
	              <button
	                className={`agent-send-btn${isLoading ? " agent-send-btn--stop" : ""}`}
	                onClick={isLoading ? handleInterrupt : handleSend}
	                disabled={!isLoading && (!activeNovelId || (!input.trim() && attachments.length === 0 && !editorSelection?.text.trim()))}
	                aria-label={isLoading ? t("agent_chat_stop") : t("agent_chat_send")}
	              >
	                {isLoading ? (
	                  <span className="agent-stop-icon" aria-hidden="true" />
	                ) : (
                    <span className="agent-send-btn__arrow" aria-hidden="true">↑</span>
	                )}
	              </button>
              </div>
            </div>
          </div>
        </div>, dockTarget ?? document.body
      )}
    </>
  );
}
