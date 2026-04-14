import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiErrorMessage, deleteMemo, fetchMemos } from "@/api/client";
import type { Memo } from "@/types";

export default function NovelMemos() {
  const { novelId } = useParams();
  const id = Number(novelId);
  const [items, setItems] = useState<Memo[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  async function load() {
    const list = await fetchMemos(id);
    setItems(list);
  }

  useEffect(() => {
    (async () => {
      try {
        await load();
      } catch (e) {
        setErr(apiErrorMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  async function remove(memoId: number) {
    if (!window.confirm("确定删除这条备忘？")) return;
    setErr("");
    try {
      await deleteMemo(id, memoId);
      setItems((prev) => prev.filter((x) => x.id !== memoId));
    } catch (e) {
      setErr(apiErrorMessage(e));
    }
  }

  if (loading) {
    return <p className="muted">加载中…</p>;
  }

  return (
    <div className="card">
      {err ? <p className="form-error">{err}</p> : null}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "0.75rem",
          marginBottom: "1rem",
        }}
      >
        <h2 style={{ fontFamily: "var(--font-serif)", margin: 0 }}>备忘</h2>
        <Link to={`/novels/${id}/memos/new`} className="btn btn-primary">
          添加备忘
        </Link>
      </div>

      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {items.map((m) => {
          const title = (m.title || "").trim();
          const rawBody = (m.body || "").trim();
          const bodyPreview = rawBody
            ? `${rawBody.slice(0, 120)}${rawBody.length > 120 ? "…" : ""}`
            : "";

          return (
          <li
            key={m.id}
            style={{
              padding: "0.65rem 0.75rem",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              justifyContent: "space-between",
              gap: "0.5rem",
              alignItems: "center",
            }}
          >
            <div>
              {title ? (
                <>
                  <strong>{title}</strong>
                  {bodyPreview ? (
                    <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>
                      {bodyPreview}
                    </p>
                  ) : (
                    <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>
                      （无正文）
                    </p>
                  )}
                </>
              ) : bodyPreview ? (
                <strong>{bodyPreview}</strong>
              ) : (
                <span className="muted">（无正文）</span>
              )}
            </div>
            <div style={{ display: "flex", gap: "0.35rem", flexShrink: 0 }}>
              <Link to={`/novels/${id}/memos/${m.id}/edit`} className="btn btn-ghost" style={{ fontSize: "0.8rem" }}>
                编辑
              </Link>
              <button type="button" className="btn btn-danger" style={{ fontSize: "0.8rem" }} onClick={() => remove(m.id)}>
                删
              </button>
            </div>
          </li>
          );
        })}
      </ul>
      {items.length === 0 ? <p className="muted">暂无备忘，点击「添加备忘」新建。</p> : null}
    </div>
  );
}
