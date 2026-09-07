import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { calculateWritingLayout, CHAPTER_WIDTH, clampWidth, readWritingLayout, TOOLS_WIDTH, WRITING_LAYOUT_KEY } from "@/utils/writingLayout";

export function useWritingLayout({ panelOpen, focusMode, desktop }: { panelOpen: boolean; focusMode: boolean; desktop: boolean }) {
  const [preference, setPreference] = useState(() => readWritingLayout(localStorage));
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(() => window.innerWidth - 48);
  const [frameHeight, setFrameHeight] = useState<number | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [resizing, setResizing] = useState(false);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const calculated = calculateWritingLayout(width, panelOpen, preference);
  const overlay = !desktop || calculated.autoCollapsed;
  const sidebarOpen = !focusMode && (overlay ? overlayOpen : preference.chaptersOpen);

  useLayoutEffect(() => {
    if (!stage) return;
    const update = () => {
      const rect = stage.getBoundingClientRect();
      setWidth(rect.width);
      setFrameHeight(Math.max(300, Math.floor(window.innerHeight - rect.top - 20)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    if (stage.parentElement) observer.observe(stage.parentElement);
    const header = document.querySelector(".novel-layout > .app-header");
    if (header) observer.observe(header);
    window.addEventListener("resize", update);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); };
  }, [stage, focusMode, desktop]);

  useEffect(() => {
    try { localStorage.setItem(WRITING_LAYOUT_KEY, JSON.stringify(preference)); } catch { /* Storage may be unavailable. */ }
  }, [preference]);
  useEffect(() => { setOverlayOpen(false); }, [panelOpen, focusMode, desktop]);
  useEffect(() => () => dragCleanupRef.current?.(), []);
  useEffect(() => {
    if (!sidebarOpen || !overlay) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const pane = stage?.querySelector<HTMLElement>("#write-chapter-pane");
    pane?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOverlayOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener?.isConnected && pane?.contains(document.activeElement)) opener.focus({ preventScroll: true });
    };
  }, [sidebarOpen, overlay, stage]);

  const toggleSidebar = useCallback(() => {
    if (overlay) setOverlayOpen((open) => !open);
    else setPreference((value) => ({ ...value, chaptersOpen: !value.chaptersOpen }));
  }, [overlay]);
  const closeOverlay = useCallback(() => setOverlayOpen(false), []);
  const setPaneWidth = useCallback((pane: "chapters" | "tools", value: number) => {
    const limits = pane === "chapters" ? CHAPTER_WIDTH : TOOLS_WIDTH;
    const key = pane === "chapters" ? "chapterWidth" : "toolsWidth";
    setPreference((current) => ({ ...current, [key]: clampWidth(value, limits.min, limits.max) }));
  }, []);

  const startResize = useCallback((pane: "chapters" | "tools", event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    const startX = event.clientX;
    const initial = pane === "chapters" ? calculated.chapterWidth : calculated.toolsWidth;
    const min = pane === "chapters" ? CHAPTER_WIDTH.min : TOOLS_WIDTH.min;
    const max = pane === "chapters" ? calculated.chapterMax : calculated.toolsMax;
    const move = (pointer: PointerEvent) => {
      const delta = (pointer.clientX - startX) * (pane === "chapters" ? 1 : -1);
      setPaneWidth(pane, clampWidth(initial + delta, min, max));
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      setResizing(false);
      dragCleanupRef.current = null;
    };
    dragCleanupRef.current?.();
    dragCleanupRef.current = cleanup;
    setResizing(true);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
  }, [calculated.chapterWidth, calculated.chapterMax, calculated.toolsWidth, calculated.toolsMax, setPaneWidth]);

  const resizeWithKeyboard = (pane: "chapters" | "tools", event: React.KeyboardEvent<HTMLDivElement>) => {
    const limits = pane === "chapters" ? CHAPTER_WIDTH : TOOLS_WIDTH;
    const max = pane === "chapters" ? calculated.chapterMax : calculated.toolsMax;
    const current = pane === "chapters" ? calculated.chapterWidth : calculated.toolsWidth;
    const step = event.shiftKey ? 40 : 16;
    const direction = pane === "chapters" ? 1 : -1;
    let next: number;
    if (event.key === "ArrowLeft") next = current - step * direction;
    else if (event.key === "ArrowRight") next = current + step * direction;
    else if (event.key === "Home") next = limits.min;
    else if (event.key === "End") next = max;
    else return;
    event.preventDefault();
    setPaneWidth(pane, clampWidth(next, limits.min, max));
  };

  return {
    ...calculated, preference, sidebarOpen, overlay, resizing,
    stageRef: setStage, toggleSidebar, closeOverlay, setPaneWidth, startResize, resizeWithKeyboard,
    resetWidths: () => setPreference((value) => ({ ...value, chapterWidth: CHAPTER_WIDTH.initial, toolsWidth: TOOLS_WIDTH.initial })),
    style: {
      "--write-chapter-width": `${calculated.chapterWidth}px`,
      "--write-tools-width": `${calculated.toolsWidth}px`,
      ...(desktop && frameHeight !== null ? { "--write-frame-height": `${frameHeight}px` } : {}),
    } as CSSProperties,
  };
}
