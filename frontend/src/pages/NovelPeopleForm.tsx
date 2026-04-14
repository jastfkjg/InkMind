import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import NovelAiNamingAskDock from "@/components/NovelAiNamingAskDock";
import { apiErrorMessage, createCharacter, fetchCharacters, updateCharacter } from "@/api/client";

export default function NovelPeopleForm() {
  const { novelId, characterId } = useParams();
  const id = Number(novelId);
  const cid = characterId ? Number(characterId) : NaN;
  const isEdit = Number.isFinite(cid);
  const nav = useNavigate();

  const [loading, setLoading] = useState(isEdit);
  const [err, setErr] = useState("");
  const [name, setName] = useState("");
  const [profile, setProfile] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      setErr("");
      try {
        const list = await fetchCharacters(id);
        const c = list.find((x) => x.id === cid);
        if (!c) {
          setErr("找不到该人物");
          return;
        }
        setName(c.name);
        setProfile(c.profile);
        setNotes(c.notes);
      } catch (e) {
        setErr(apiErrorMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id, cid, isEdit]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setSaving(true);
    try {
      if (isEdit) {
        await updateCharacter(id, cid, { name, profile, notes });
      } else {
        await createCharacter(id, { name, profile, notes });
      }
      nav(`/novels/${id}/people`);
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="muted">加载中…</p>;
  }

  return (
    <div className="write-shell write-shell--form">
      <div className="card people-form-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <h2 style={{ fontFamily: "var(--font-serif)", margin: 0 }}>{isEdit ? "编辑人物" : "新建人物"}</h2>
          <button type="button" className="btn btn-ghost" onClick={() => nav(`/novels/${id}/people`)}>
            返回
          </button>
        </div>

        {err ? <p className="form-error" style={{ marginTop: "0.75rem" }}>{err}</p> : null}

        <form onSubmit={onSubmit} style={{ marginTop: "1rem" }}>
          <div className="field">
            <label>姓名</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="field">
            <label>性格 / 设定</label>
            <textarea rows={4} className="textarea" value={profile} onChange={(e) => setProfile(e.target.value)} />
          </div>
          <div className="field">
            <label>其他描述</label>
            <textarea rows={3} className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "保存中…" : isEdit ? "保存修改" : "添加人物"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => nav(`/novels/${id}/people`)}>
              取消
            </button>
          </div>
        </form>
      </div>

      <NovelAiNamingAskDock novelId={id} />
    </div>
  );
}
