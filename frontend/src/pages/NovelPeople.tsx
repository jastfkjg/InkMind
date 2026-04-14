import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiErrorMessage, deleteCharacter, fetchCharacters } from "@/api/client";
import type { Character } from "@/types";

export default function NovelPeople() {
  const { novelId } = useParams();
  const id = Number(novelId);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  async function load() {
    const chars = await fetchCharacters(id);
    setCharacters(chars);
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

  async function removeChar(cid: number) {
    if (!window.confirm("确定删除该人物？")) return;
    setErr("");
    try {
      await deleteCharacter(id, cid);
      setCharacters((prev) => prev.filter((c) => c.id !== cid));
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
        <h2 style={{ fontFamily: "var(--font-serif)", margin: 0 }}>人物</h2>
        <Link to={`/novels/${id}/people/new`} className="btn btn-primary">
          添加人物
        </Link>
      </div>

      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {characters.map((c) => (
          <li
            key={c.id}
            style={{
              padding: "0.65rem 0.75rem",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              justifyContent: "space-between",
              gap: "0.5rem",
              alignItems: "start",
            }}
          >
            <div>
              <strong>{c.name}</strong>
              <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>
                {c.profile ? `${c.profile.slice(0, 50)}${c.profile.length > 50 ? "…" : ""}` : "（未填性格/设定）"}
                  &nbsp;&nbsp;&nbsp;
                  {c.notes ? `( ${c.notes.slice(0, 60)}
                  ${c.notes.length > 60 ? "…" : ""})`: ""}
              </p>
            </div>
            <div style={{ display: "flex", gap: "0.35rem", flexShrink: 0 }}>
              <Link to={`/novels/${id}/people/${c.id}/edit`} className="btn btn-ghost" style={{ fontSize: "0.8rem" }}>
                编辑
              </Link>
              <button type="button" className="btn btn-danger" style={{ fontSize: "0.8rem" }} onClick={() => removeChar(c.id)}>
                删
              </button>
            </div>
          </li>
        ))}
      </ul>
      {characters.length === 0 ? <p className="muted">暂无人物，点击「添加人物」新建。</p> : null}
    </div>
  );
}
