import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  apiErrorMessage,
  createCharacter,
  createRelationship,
  deleteCharacter,
  deleteRelationship,
  fetchCharacters,
  fetchRelationships,
  updateCharacter,
  updateRelationship,
} from "@/api/client";
import type { Character, Relationship } from "@/types";

export default function NovelPeople() {
  const { novelId } = useParams();
  const id = Number(novelId);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [editId, setEditId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [profile, setProfile] = useState("");
  const [notes, setNotes] = useState("");

  const [relA, setRelA] = useState<number | "">("");
  const [relB, setRelB] = useState<number | "">("");
  const [relDesc, setRelDesc] = useState("");

  async function load() {
    const [chars, rels] = await Promise.all([fetchCharacters(id), fetchRelationships(id)]);
    setCharacters(chars);
    setRelationships(rels);
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

  const nameById = useMemo(() => {
    const m = new Map<number, string>();
    characters.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [characters]);

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
    if (!window.confirm("删除该人物将同时删除相关关系，确定？")) return;
    setErr("");
    try {
      await deleteCharacter(id, cid);
      await load();
      if (editId === cid) startNewChar();
    } catch (e) {
      setErr(apiErrorMessage(e));
    }
  }

  async function addRel(e: React.FormEvent) {
    e.preventDefault();
    if (relA === "" || relB === "" || relA === relB) {
      setErr("请选择两个不同人物");
      return;
    }
    setErr("");
    try {
      const r = await createRelationship(id, relA, relB, relDesc);
      setRelationships((prev) => [...prev, r]);
      setRelDesc("");
    } catch (e) {
      setErr(apiErrorMessage(e));
    }
  }

  async function removeRel(rid: number) {
    setErr("");
    try {
      await deleteRelationship(id, rid);
      setRelationships((prev) => prev.filter((r) => r.id !== rid));
    } catch (e) {
      setErr(apiErrorMessage(e));
    }
  }

  async function patchRel(r: Relationship, desc: string) {
    setErr("");
    try {
      const u = await updateRelationship(id, r.id, desc);
      setRelationships((prev) => prev.map((x) => (x.id === u.id ? u : x)));
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
        <h2 style={{ fontFamily: "var(--font-serif)", marginTop: 0 }}>人物设定</h2>
        <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          <div>
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
                      {c.profile ? `${c.profile.slice(0, 80)}${c.profile.length > 80 ? "…" : ""}` : "（无简介）"}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "0.35rem", flexShrink: 0 }}>
                    <button type="button" className="btn btn-ghost" style={{ fontSize: "0.8rem" }} onClick={() => startEdit(c)}>
                      编辑
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      style={{ fontSize: "0.8rem" }}
                      onClick={() => removeChar(c.id)}
                    >
                      删
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {characters.length === 0 ? <p className="muted">暂无人物</p> : null}
          </div>

          <form onSubmit={saveChar}>
            <div className="field">
              <label>姓名</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="field">
              <label>设定 / 性格 / 背景</label>
              <textarea className="textarea" rows={5} value={profile} onChange={(e) => setProfile(e.target.value)} />
            </div>
            <div className="field">
              <label>备注（可选）</label>
              <textarea className="textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="submit" className="btn btn-primary">
                {editId ? "保存修改" : "添加人物"}
              </button>
              {editId ? (
                <button type="button" className="btn btn-ghost" onClick={startNewChar}>
                  取消
                </button>
              ) : null}
            </div>
          </form>
        </div>
      </div>

      <div className="card">
        <h2 style={{ fontFamily: "var(--font-serif)", marginTop: 0 }}>人物关系</h2>
        <form onSubmit={addRel} style={{ marginBottom: "1rem" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "end" }}>
            <div className="field" style={{ marginBottom: 0, minWidth: 140 }}>
              <label>人物 A</label>
              <select className="input" value={relA} onChange={(e) => setRelA(e.target.value ? Number(e.target.value) : "")}>
                <option value="">选择</option>
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0, minWidth: 140 }}>
              <label>人物 B</label>
              <select className="input" value={relB} onChange={(e) => setRelB(e.target.value ? Number(e.target.value) : "")}>
                <option value="">选择</option>
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
              <label>关系说明</label>
              <input className="input" value={relDesc} onChange={(e) => setRelDesc(e.target.value)} placeholder="例如：师徒、旧识…" />
            </div>
            <button type="submit" className="btn btn-primary">
              添加关系
            </button>
          </div>
        </form>

        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {relationships.map((r) => (
            <li
              key={r.id}
              style={{
                padding: "0.75rem 0",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" }}>
                <span>
                  <strong>{nameById.get(r.character_a_id) ?? "?"}</strong>
                  {" — "}
                  <strong>{nameById.get(r.character_b_id) ?? "?"}</strong>
                </span>
                <button type="button" className="btn btn-danger" style={{ fontSize: "0.8rem" }} onClick={() => removeRel(r.id)}>
                  删除
                </button>
              </div>
              <textarea
                className="textarea"
                style={{ marginTop: "0.5rem", minHeight: 72 }}
                defaultValue={r.description}
                onBlur={(e) => {
                  const v = e.target.value;
                  if (v !== r.description) patchRel(r, v);
                }}
              />
            </li>
          ))}
        </ul>
        {relationships.length === 0 ? <p className="muted">暂无关系</p> : null}
      </div>
    </div>
  );
}
