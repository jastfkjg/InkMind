import { useEffect, useRef, useState } from "react";
import { ColumnWidthOutlined } from "@ant-design/icons";
import { useI18n } from "@/i18n";
import { CHAPTER_WIDTH, TOOLS_WIDTH } from "@/utils/writingLayout";
import type { useWritingLayout } from "./useWritingLayout";

type WritingLayout = ReturnType<typeof useWritingLayout>;

export function WritingPaneResizeHandle({ pane, layout }: { pane: "chapters" | "tools"; layout: WritingLayout }) {
  const { t } = useI18n();
  const limits = pane === "chapters" ? CHAPTER_WIDTH : TOOLS_WIDTH;
  return <div
    className={`write-pane-resize write-pane-resize--${pane}`}
    role="separator"
    tabIndex={0}
    aria-orientation="vertical"
    aria-label={t(pane === "chapters" ? "write_layout_resize_chapters" : "write_layout_resize_tools")}
    aria-controls={pane === "chapters" ? "write-chapter-pane" : undefined}
    aria-valuemin={limits.min}
    aria-valuemax={pane === "chapters" ? layout.chapterMax : layout.toolsMax}
    aria-valuenow={pane === "chapters" ? layout.chapterWidth : layout.toolsWidth}
    title={t("write_layout_resize_hint")}
    onPointerDown={(event) => layout.startResize(pane, event)}
    onKeyDown={(event) => layout.resizeWithKeyboard(pane, event)}
    onDoubleClick={() => layout.setPaneWidth(pane, limits.initial)}
  />;
}

export default function WritingLayoutControls({ layout }: { layout: WritingLayout }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const click = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", click);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", click); document.removeEventListener("keydown", key); };
  }, [open]);
  return <div className="write-layout-picker" ref={root}>
    <button type="button" className="write-icon-btn" title={t("write_layout_widths")} aria-label={t("write_layout_widths")} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((value) => !value)}><ColumnWidthOutlined aria-hidden="true" /></button>
    {open && <div className="write-layout-popover" role="dialog" aria-label={t("write_layout_widths")}>
      {(["chapters", "tools"] as const).map((pane) => {
        const limits = pane === "chapters" ? CHAPTER_WIDTH : TOOLS_WIDTH;
        const value = pane === "chapters" ? layout.preference.chapterWidth : layout.preference.toolsWidth;
        return <label key={pane} className="write-layout-range">
          <span>{t(pane === "chapters" ? "write_layout_chapters_width" : "write_layout_tools_width")}<output>{value}px</output></span>
          <input type="range" aria-label={t(pane === "chapters" ? "write_layout_chapters_width" : "write_layout_tools_width")} min={limits.min} max={limits.max} step={4} value={value} onChange={(event) => layout.setPaneWidth(pane, Number(event.target.value))} />
        </label>;
      })}
      <p>{t("write_layout_width_hint")}</p>
      <button type="button" className="write-retry-save" onClick={layout.resetWidths}>{t("write_layout_reset")}</button>
    </div>}
  </div>;
}
