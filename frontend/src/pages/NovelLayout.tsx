import { NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import UserMenu from "@/components/UserMenu";
import { apiErrorMessage, fetchNovel } from "@/api/client";
import type { Novel } from "@/types";

export default function NovelLayout() {
  const { novelId } = useParams();
  const id = Number(novelId);
  const nav = useNavigate();
  const loc = useLocation();
  const peopleTabActive = loc.pathname.startsWith(`/novels/${id}/people`);
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
    <div className="app-shell app-shell--novel">
      <header className="novel-bar">
        <div className="novel-bar__row">
          <button type="button" className="btn btn-ghost novel-bar__back" onClick={() => nav("/")}>
            ← 返回
          </button>
          <nav className="tabs novel-tabs" aria-label="作品导航">
            <NavLink
              to={`/novels/${id}/settings`}
              className={({ isActive }) => `tab${isActive ? " active" : ""}`}
            >
              设定
            </NavLink>
            <NavLink to={`/novels/${id}/write`} className={({ isActive }) => `tab${isActive ? " active" : ""}`}>
              写作
            </NavLink>
            <NavLink
              to={`/novels/${id}/people`}
              className={() => `tab${peopleTabActive ? " active" : ""}`}
            >
              人物
            </NavLink>
          </nav>
        </div>
        <UserMenu />
      </header>

      {err ? <p className="form-error novel-bar__err">{err}</p> : null}

      <Outlet context={{ novel, setNovel }} />
    </div>
  );
}
