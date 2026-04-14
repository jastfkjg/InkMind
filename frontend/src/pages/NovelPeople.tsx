import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  apiErrorMessage,
  createCharacter,
  deleteCharacter,
  fetchCharacters,
  updateCharacter,
} from "@/api/client";
import type { Character } from "@/types";

export default function NovelPeople() {
  const { novelId } = useParams();
  const id = Number(novelId);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [editId, setEditId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [profile, setProfile] = useState("");
  const [notes, setNotes] = useState("");
  const nameInputRef = useRef<HTMLInputElement | null>(null);

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

  function startNewChar() {
    setEditId(null);
    setName("");
    setProfile("");
    setNotes("");
  }

  function startEdit(c: Character) {
    setEditId(c.id);
    setName(c.name);
    setProfile(c.profile);
    setNotes(c.notes);
  }

  async function saveChar(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      if (editId) {
        const c = await updateCharacter(id, editId, { name, profile, notes });
        setCharacters((prev) => prev.map((x) => (x.id === c.id ? c : x)));
      } else {
        const c = await createCharacter(id, { name, profile, notes });
        setCharacters((prev) => [...prev, c]);
      }
      startNewChar();
    } catch (e) {
      setErr(apiErrorMessage(e));
    }
  }

  async function removeChar(cid: number) {
    if (!window.confirm("确定删除该人物？")) return;
    setErr("");
    try {
      await deleteCharacter(id, cid);
      setCharacters((prev) => prev.filter((c) => c.id !== cid));
      if (editId === cid) startNewChar();
    } catch (e) {
      setErr(apiErrorMessage(e));
    }
  }

  if (loading) {
    return <p className="muted">加载中…</p>;
  }

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {err ? <p className="form-error">{err}</p> : null}

      <div className="card">
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
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              startNewChar();
              nameInputRef.current?.focus();
            }}
          >
            添加人物
          </button>
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
                  {c.profile ? `${c.profile.slice(0, 100)}${c.profile.length > 100 ? "…" : ""}` : "（未填性格/设定）"}
                </p>
                {c.notes ? (
                  <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.8rem" }}>
                    其他：{c.notes.slice(0, 120)}
                    {c.notes.length > 120 ? "…" : ""}
                  </p>
                ) : null}
              </div>
              <div style={{ display: "flex", gap: "0.35rem", flexShrink: 0 }}>
                <button type="button" className="btn btn-ghost" style={{ fontSize: "0.8rem" }} onClick={() => startEdit(c)}>
                  编辑
                </button>
                <button type="button" className="btn btn-danger" style={{ fontSize: "0.8rem" }} onClick={() => removeChar(c.id)}>
                  删
                </button>
              </div>
            </li>
          ))}
        </ul>
        {characters.length === 0 ? <p className="muted">暂无人物，点击「添加人物」开始。</p> : null}
      </div>

      <div className="card">
        <h3 style={{ fontFamily: "var(--font-serif)", marginTop: 0, fontSize: "1.1rem" }}>
          {editId ? "编辑人物" : "新建人物"}
        </h3>
        <form onSubmit={saveChar}>
          <div className="field">
            <label>姓名</label>
            <input
              ref={nameInputRef}
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label>性格 / 设定</label>
            <textarea rows={4} className="textarea" value={profile} onChange={(e) => setProfile(e.target.value)} />
          </div>
          <div className="field">
            <label>其他描述</label>
            <textarea rows={3} className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="submit" className="btn btn-primary">
              {editId ? "保存修改" : "添加人物"}
            </button>
            {editId ? (
              <button type="button" className="btn btn-ghost" onClick={startNewChar}>
                取消编辑
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}
