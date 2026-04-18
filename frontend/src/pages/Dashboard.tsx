import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  apiErrorMessage,
  createNovel,
  deleteNovel,
  fetchNovels,
} from "@/api/client";
import ExportNovelModal from "@/components/ExportNovelModal";
import UserMenu from "@/components/UserMenu";
import { useAuth } from "@/context/AuthContext";
import type { Novel } from "@/types";
import { isNovelSetupComplete, novelPrimaryHref } from "@/utils/novelSetup";

export default function Dashboard() {
  const { user } = useAuth();
  const [novels, setNovels] = useState<Novel[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [creating, setCreating] = useState(false);
  const [exportNovel, setExportNovel] = useState<Novel | null>(null);

  async function load() {
    setErr("");
    try {
      const list = await fetchNovels();
      setNovels(list);
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onCreate() {
    setCreating(true);
    try {
      const n = await createNovel({ title: "未命名作品" });
      setNovels((prev) => [n, ...prev]);
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setCreating(false);
    }
  }

  async function onDelete(id: number, title: string) {
    if (!window.confirm(`确定删除《${title}》？此操作不可恢复。`)) return;
    try {
      await deleteNovel(id);
      setNovels((prev) => prev.filter((x) => x.id !== id));
    } catch (e) {
      setErr(apiErrorMessage(e));
    }
  }

  return (
    <div className="app-shell">
      <header className="top-bar top-bar--dashboard">
        <div>
          <div className="brand brand--list">InkMind</div>
          <p className="muted" style={{ margin: "0.25rem 0 0" }}>
            {user?.display_name || user?.email}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" disabled={creating} onClick={onCreate}>
            {creating ? "创建中…" : "新建作品"}
          </button>
          <UserMenu />
        </div>
      </header>

      {err ? <p className="form-error">{err}</p> : null}

      {loading ? (
        <p className="muted">加载中…</p>
      ) : novels.length === 0 ? (
        <div className="card">
          <p style={{ margin: 0 }}>还没有作品。点击「新建作品」开始。</p>
        </div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {novels.map((n) => {
            const entry = novelPrimaryHref(n);
            const ready = isNovelSetupComplete(n);
            return (
              <li key={n.id} className="card" style={{ marginBottom: "0.75rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                  <div>
                    <Link
                      to={entry}
                      style={{ fontFamily: "var(--font-serif)", fontSize: "1.15rem", fontWeight: 600 }}
                    >
                      {n.title || "未命名"}
                    </Link>
                    <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>
                      {n.genre ? `类型：${n.genre}` : "未设置类型"}
                      {"  ·  "}
                      {new Date(n.updated_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="dashboard-novel-actions">
                    <Link
                      to={entry}
                      className="btn btn-ghost dashboard-icon-btn"
                      aria-label={ready ? `打开《${n.title || "未命名"}》写作` : `完善《${n.title || "未命名"}》设定`}
                      title={ready ? "写作" : "作品设定"}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden>
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                      </svg>
                    </Link>
                    <button
                      type="button"
                      className="btn btn-ghost dashboard-icon-btn"
                      aria-label={`导出《${n.title || "未命名"}》`}
                      title="导出"
                      onClick={() => setExportNovel(n)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden>
                        <path d="M12 3v12" />
                        <path d="M7 10l5 5 5-5" />
                        <path d="M5 21h14" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger dashboard-icon-btn"
                      aria-label={`删除《${n.title || "未命名"}》`}
                      title="删除"
                      onClick={() => onDelete(n.id, n.title)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden>
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="M19 6l-1 14H6L5 6" />
                        <path d="M10 11v6M14 11v6" />
                      </svg>
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {exportNovel ? <ExportNovelModal novel={exportNovel} onClose={() => setExportNovel(null)} /> : null}
    </div>
  );
}
