import { NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import UserMenu from "@/components/UserMenu";
import { apiErrorMessage, fetchNovel } from "@/api/client";
import type { Novel } from "@/types";

export default function NovelLayout() {
  const { novelId } = useParams();
  const id = Number(novelId);
  const nav = useNavigate();
  const [novel, setNovel] = useState<Novel | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!Number.isFinite(id)) {
      nav("/", { replace: true });
      return;
    }
    (async () => {
      try {
        const n = await fetchNovel(id);
        setNovel(n);
      } catch (e) {
        setErr(apiErrorMessage(e));
      }
    })();
  }, [id, nav]);

  if (!Number.isFinite(id)) {
    return null;
  }

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div>
          <button type="button" className="btn btn-ghost" style={{ marginBottom: "0.35rem" }} onClick={() => nav("/")}>
            ← 作品列表
          </button>
          <div className="brand" style={{ fontSize: "1.25rem" }}>
            {novel?.title || "加载中…"}
          </div>
        </div>
        <UserMenu />
      </header>

      {err ? <p className="form-error">{err}</p> : null}

      <nav className="tabs">
        <NavLink
          to={`/novels/${id}/settings`}
          className={({ isActive }) => `tab${isActive ? " active" : ""}`}
        >
          写作前设定
        </NavLink>
        <NavLink to={`/novels/${id}/write`} className={({ isActive }) => `tab${isActive ? " active" : ""}`}>
          写作
        </NavLink>
        <NavLink to={`/novels/${id}/people`} className={({ isActive }) => `tab${isActive ? " active" : ""}`}>
          人物与关系
        </NavLink>
      </nav>

      <Outlet context={{ novel, setNovel }} />
    </div>
  );
}
