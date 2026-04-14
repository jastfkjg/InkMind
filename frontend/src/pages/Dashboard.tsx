import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  apiErrorMessage,
  createNovel,
  deleteNovel,
  fetchNovels,
} from "@/api/client";
import UserMenu from "@/components/UserMenu";
import { useAuth } from "@/context/AuthContext";
import type { Novel } from "@/types";

export default function Dashboard() {
  const { user } = useAuth();
  const [novels, setNovels] = useState<Novel[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [creating, setCreating] = useState(false);

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
          <div className="brand brand--list">书名</div>
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
          {novels.map((n) => (
            <li key={n.id} className="card" style={{ marginBottom: "0.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                <div>
                  <Link
                    to={`/novels/${n.id}/write`}
                    style={{ fontFamily: "var(--font-serif)", fontSize: "1.15rem", fontWeight: 600 }}
                  >
                    {n.title || "未命名"}
                  </Link>
                  <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>
                    {n.genre ? `类型：${n.genre}` : "未设置类型"}
                    {" · "}
                    更新 {new Date(n.updated_at).toLocaleString()}
                  </p>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <Link
                    to={`/novels/${n.id}/settings`}
                    className="btn btn-ghost"
                    style={{ fontSize: "0.85rem" }}
                  >
                    设定
                  </Link>
                  <Link to={`/novels/${n.id}/write`} className="btn btn-ghost" style={{ fontSize: "0.85rem" }}>
                    写作
                  </Link>
                  <button
                    type="button"
                    className="btn btn-danger"
                    style={{ fontSize: "0.85rem" }}
                    onClick={() => onDelete(n.id, n.title)}
                  >
                    删除
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
