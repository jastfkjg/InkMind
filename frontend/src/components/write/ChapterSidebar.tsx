import { memo, useState } from "react";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { useI18n } from "@/i18n";
import type { Chapter } from "@/types";

interface ChapterSidebarProps {
  chapters: Chapter[];
  activeId: number | null;
  sidebarOpen: boolean;
  onSelectChapter: (id: number) => void;
  onAddChapter: () => void;
  onDeleteChapter: (id: number) => void;
  disabled?: boolean;
  selectionDisabled?: boolean;
}

function ChapterSidebar({
  chapters,
  activeId,
  sidebarOpen,
  onSelectChapter,
  onAddChapter,
  onDeleteChapter,
  disabled = false,
  selectionDisabled = disabled,
}: ChapterSidebarProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const filtered = chapters.map((chapter, index) => ({ chapter, index })).filter(({ chapter, index }) =>
    `${index + 1} ${chapter.title}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  );

  return (
    <aside className={`write-left-sidebar${sidebarOpen ? " is-open" : ""}`} aria-label={t("write_chapters")}>
      <div className="write-left-inner card">
        <div className="write-left-head">
          <div className="write-chapter-heading"><strong>{t("write_chapters")}</strong><span className="write-chapter-count">{chapters.length}</span></div>
          <button type="button" disabled={disabled} className="btn btn-ghost write-chapter-add-btn" title={t("write_new_chapter")} aria-label={t("write_new_chapter")} onClick={(e) => { e.stopPropagation(); void onAddChapter(); }}>
            <PlusOutlined aria-hidden="true" />
          </button>
        </div>
        <div className="write-chapter-search-field">
          <SearchOutlined aria-hidden="true" />
          <input className="input write-chapter-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("write_search_chapters")} aria-label={t("write_search_chapters")} />
        </div>
        <div className="chapter-list stack-sm">
          {chapters.length === 0 ? (
            <p className="muted write-chapter-empty-hint">
              {t("write_no_chapters")}
            </p>
          ) : (
            filtered.map(({ chapter: c, index: idx }) => (
              <div key={c.id} className="chapter-row">
                <button
                  type="button"
                  disabled={selectionDisabled}
                  aria-current={c.id === activeId ? "page" : undefined}
                  title={c.title?.trim() || t("write_untitled_chapter")}
                  className={`chapter-item${c.id === activeId ? " active" : ""}`}
                  onClick={(e) => { e.stopPropagation(); void onSelectChapter(c.id); }}
                >
                  <span className="chapter-item__number">{t("write_chapter_number").replace("{number}", String(idx + 1))}</span>
                  <span className="chapter-item__title">{c.title?.trim() || t("write_untitled_chapter")}</span>
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  className="chapter-del"
                  title={t("write_delete_chapter")}
                  aria-label={t("write_delete_chapter")}
                  onClick={(e) => { e.stopPropagation(); void onDeleteChapter(c.id); }}
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
          {chapters.length > 0 && filtered.length === 0 && <p className="muted write-chapter-empty-hint">{t("write_search_empty")}</p>}
        </div>
      </div>
    </aside>
  );
}

export default memo(ChapterSidebar);
