import { useI18n } from "@/i18n";
import type { Chapter } from "@/types";

export interface ChapterSidebarProps {
  sidebarOpen: boolean;
  chapters: Chapter[];
  activeId: number | null;
  onAddChapter: () => void;
  onSelectChapter: (id: number) => void;
  onDeleteChapter: (id: number) => void;
}

export default function ChapterSidebar({
  sidebarOpen,
  chapters,
  activeId,
  onAddChapter,
  onSelectChapter,
  onDeleteChapter,
}: ChapterSidebarProps) {
  const { t } = useI18n();

  return (
    <aside className={`write-left-sidebar${sidebarOpen ? " is-open" : ""}`}>
      <div className="write-left-inner card">
        <div className="write-left-head">
          <strong>{t("write_chapters")}</strong>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: "0.85rem" }}
            onClick={(e) => {
              e.stopPropagation();
              onAddChapter();
            }}
          >
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
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectChapter(c.id);
                  }}
                >
                  {c.title?.trim() ||
                    `${t("write_chapter_n")} ${idx + 1}${t("write_chapter_n_suffix")}`}
                </button>
                <button
                  type="button"
                  className="chapter-del"
                  title={t("write_delete_chapter")}
                  aria-label={t("write_delete_chapter")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteChapter(c.id);
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
  );
}
