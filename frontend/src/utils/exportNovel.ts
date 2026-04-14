import type { Chapter, Novel } from "@/types";

export type ExportTextFormat = "txt" | "md";
export type ExportFormat = ExportTextFormat | "pdf";

/** 文件名安全化，避免路径符等 */
export function safeExportBaseName(title: string): string {
  const t = (title || "未命名").trim() || "未命名";
  return t.replace(/[/\\?%*:|"<>]/g, "_").slice(0, 80);
}

export function sortChaptersForExport(chapters: Chapter[]): Chapter[] {
  return chapters.slice().sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.id - b.id;
  });
}

/** 根据范围筛选章节（保持顺序） */
export function chaptersForScope(
  chapters: Chapter[],
  scope: "all" | "partial",
  selectedIds: ReadonlySet<number>
): Chapter[] {
  const sorted = sortChaptersForExport(chapters);
  if (scope === "all") return sorted;
  return sorted.filter((c) => selectedIds.has(c.id));
}

function formatMetaLine(novel: Novel): string {
  const parts: string[] = [];
  if (novel.genre?.trim()) parts.push(`类型：${novel.genre.trim()}`);
  parts.push(`导出时间：${new Date().toLocaleString()}`);
  return parts.join("  ·  ");
}

export function buildExportPlainText(novel: Novel, list: Chapter[]): string {
  const lines: string[] = [];
  const title = novel.title?.trim() || "未命名";
  lines.push(`《${title}》`);
  lines.push(formatMetaLine(novel));
  lines.push("");
  const bg = novel.background?.trim();
  if (bg) {
    lines.push("—— 作品背景 ——");
    lines.push(bg);
    lines.push("");
  }
  if (list.length === 0) {
    lines.push("（暂无章节）");
    return lines.join("\n");
  }
  list.forEach((ch, i) => {
    lines.push(`${"=".repeat(32)}`);
    const chTitle = ch.title?.trim() || `第 ${i + 1} 章`;
    lines.push(`「${chTitle}」`);
    lines.push((ch.content || "").trimEnd());
    lines.push("");
  });
  return lines.join("\n").trimEnd() + "\n";
}

export function buildExportMarkdown(novel: Novel, list: Chapter[]): string {
  const title = novel.title?.trim() || "未命名";
  const parts: string[] = [];
  parts.push(`# 《${title}》`);
  parts.push("");
  parts.push(`*${formatMetaLine(novel)}*`);
  parts.push("");
  const bg = novel.background?.trim();
  if (bg) {
    parts.push("## 作品背景");
    parts.push("");
    parts.push(bg);
    parts.push("");
  }
  if (list.length === 0) {
    parts.push("*（暂无章节）*");
    return parts.join("\n");
  }
  list.forEach((ch, i) => {
    const chTitle = ch.title?.trim() || `第 ${i + 1} 章`;
    parts.push("---");
    parts.push("");
    parts.push(`## ${chTitle}`);
    parts.push("");
    parts.push((ch.content || "").trimEnd());
    parts.push("");
  });
  return parts.join("\n").trimEnd() + "\n";
}

export function downloadTextFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadPdfBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.click();
  URL.revokeObjectURL(url);
}
