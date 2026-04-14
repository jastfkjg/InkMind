import { useEffect, useMemo, useState } from "react";
import { apiErrorMessage, exportNovelPdfBlob, fetchChapters, fetchNovel } from "@/api/client";
import type { Chapter, Novel } from "@/types";
import {
  buildExportMarkdown,
  buildExportPlainText,
  chaptersForScope,
  downloadPdfBlob,
  downloadTextFile,
  safeExportBaseName,
  sortChaptersForExport,
  type ExportFormat,
} from "@/utils/exportNovel";

type Props = {
  novel: Novel;
  onClose: () => void;
};

export default function ExportNovelModal({ novel, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [novelFull, setNovelFull] = useState<Novel>(novel);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [err, setErr] = useState("");
  const [scope, setScope] = useState<"all" | "partial">("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [format, setFormat] = useState<ExportFormat>("txt");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setErr("");
      setLoading(true);
      try {
        const [n, chs] = await Promise.all([fetchNovel(novel.id), fetchChapters(novel.id)]);
        if (cancelled) return;
        setNovelFull(n);
        const sorted = sortChaptersForExport(chs);
        setChapters(sorted);
        setSelected(new Set(sorted.map((c) => c.id)));
      } catch (e) {
        if (!cancelled) setErr(apiErrorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [novel.id]);

  const exportList = useMemo(
    () => chaptersForScope(chapters, scope, selected),
    [chapters, scope, selected]
  );

  const canPartial = scope === "partial" && selected.size > 0;

  const canExport = !loading && !err && (scope === "all" || canPartial);

  function toggleId(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllChapters() {
    setSelected(new Set(chapters.map((c) => c.id)));
  }

  function clearChapterSelection() {
    setSelected(new Set());
  }

  async function onExport() {
    if (!canExport || busy) return;
    setBusy(true);
    setErr("");
    const base = safeExportBaseName(novelFull.title);
    try {
      if (format === "pdf") {
        const chapterIds = scope === "all" ? null : Array.from(selected);
        const blob = await exportNovelPdfBlob(novelFull.id, chapterIds);
        downloadPdfBlob(blob, `${base}.pdf`);
      } else {
        const text =
          format === "md"
            ? buildExportMarkdown(novelFull, exportList)
            : buildExportPlainText(novelFull, exportList);
        const ext = format === "md" ? ".md" : ".txt";
        const mime = format === "md" ? "text/markdown" : "text/plain";
        downloadTextFile(text, `${base}${ext}`, mime);
      }
      onClose();
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="export-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
      onClick={onClose}
    >
      <div className="export-modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="export-modal-head">
          <h2 id="export-modal-title" style={{ margin: 0, fontFamily: "var(--font-serif)", fontSize: "1.2rem" }}>
            导出作品
          </h2>
          <button type="button" className="btn btn-ghost" style={{ fontSize: "0.85rem" }} onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="export-modal-body">
          <p className="muted" style={{ margin: "0 0 1rem", fontSize: "0.9rem" }}>
            《{novelFull.title || "未命名"}》
          </p>
          <p className="hint" style={{ margin: "0 0 1rem", fontSize: "0.82rem" }}>
            导出内容含作品背景与各章标题、正文，不含章节概要。
          </p>

          {err ? <p className="form-error">{err}</p> : null}

          {loading ? (
            <p className="muted" style={{ margin: 0 }}>
              加载章节…
            </p>
          ) : (
            <>
              <fieldset className="export-modal-fieldset">
                <legend>范围</legend>
                <label className="export-modal-radio">
                  <input
                    type="radio"
                    name="export-scope"
                    checked={scope === "all"}
                    onChange={() => setScope("all")}
                  />
                  整本书（全部章节按顺序）
                </label>
                <label className="export-modal-radio">
                  <input
                    type="radio"
                    name="export-scope"
                    checked={scope === "partial"}
                    onChange={() => setScope("partial")}
                  />
                  选定章节
                </label>
              </fieldset>

              {scope === "partial" ? (
                <div className="export-modal-chapters">
                  <div className="export-modal-chapter-actions">
                    <button type="button" className="btn btn-ghost" style={{ fontSize: "0.8rem" }} onClick={selectAllChapters}>
                      全选
                    </button>
                    <button type="button" className="btn btn-ghost" style={{ fontSize: "0.8rem" }} onClick={clearChapterSelection}>
                      全不选
                    </button>
                  </div>
                  <div className="export-modal-chapter-list" role="group" aria-label="章节列表">
                    {chapters.length === 0 ? (
                      <p className="muted" style={{ margin: 0 }}>
                        暂无章节
                      </p>
                    ) : (
                      chapters.map((c, i) => (
                        <label key={c.id} className="export-modal-check">
                          <input
                            type="checkbox"
                            checked={selected.has(c.id)}
                            onChange={() => toggleId(c.id)}
                          />
                          <span>
                            {c.title?.trim() || `第 ${i + 1} 章`}
                            <span className="muted" style={{ fontSize: "0.8rem", marginLeft: "0.35rem" }}>
                              #{c.sort_order}
                            </span>
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                  {scope === "partial" && selected.size === 0 ? (
                    <p className="form-error" style={{ margin: "0.5rem 0 0", fontSize: "0.85rem" }}>
                      请至少勾选一章
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="field" style={{ marginTop: "1rem" }}>
                <label htmlFor="export-format">格式</label>
                <select
                  id="export-format"
                  className="input"
                  value={format}
                  onChange={(e) => setFormat(e.target.value as ExportFormat)}
                >
                  <option value="txt">TXT</option>
                  <option value="md">Markdown</option>
                  <option value="pdf">PDF</option>
                </select>
              </div>

              {format === "pdf" ? (
                <p className="hint" style={{ margin: "0.75rem 0 0", fontSize: "0.85rem" }}>
                  PDF 为服务器按纯文本排版生成：若本机无合适中文字体，可能用西文字体且中文显示为问号，可改用 TXT 全文备份。
                </p>
              ) : null}
            </>
          )}
        </div>
        <div className="export-modal-foot">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn-primary" disabled={!canExport || busy} onClick={() => void onExport()}>
            {busy ? "生成中…" : "下载"}
          </button>
        </div>
      </div>
    </div>
  );
}
