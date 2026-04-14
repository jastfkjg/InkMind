import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiErrorMessage, createMemo, fetchMemos, updateMemo } from "@/api/client";

export default function NovelMemoForm() {
  const { novelId, memoId } = useParams();
  const id = Number(novelId);
  const mid = memoId ? Number(memoId) : NaN;
  const isEdit = Number.isFinite(mid);
  const nav = useNavigate();

  const [loading, setLoading] = useState(isEdit);
  const [err, setErr] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      setErr("");
      try {
        const list = await fetchMemos(id);
        const m = list.find((x) => x.id === mid);
        if (!m) {
          setErr("找不到该备忘");
          return;
        }
        setTitle(m.title);
        setBody(m.body);
      } catch (e) {
        setErr(apiErrorMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id, mid, isEdit]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setSaving(true);
    try {
      if (isEdit) {
        await updateMemo(id, mid, { title, body });
      } else {
        await createMemo(id, { title, body });
      }
      nav(`/novels/${id}/memos`);
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
    <div className="card" style={{ maxWidth: 720 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <h2 style={{ fontFamily: "var(--font-serif)", margin: 0 }}>{isEdit ? "编辑备忘" : "新建备忘"}</h2>
        <button type="button" className="btn btn-ghost" onClick={() => nav(`/novels/${id}/memos`)}>
          返回列表
        </button>
      </div>

      {err ? <p className="form-error" style={{ marginTop: "0.75rem" }}>{err}</p> : null}

      <form onSubmit={onSubmit} style={{ marginTop: "1rem" }}>
        <div className="field">
          <label>标题（可选）</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="简要标题" />
        </div>
        <div className="field">
          <label>正文</label>
          <textarea rows={12} className="textarea" value={body} onChange={(e) => setBody(e.target.value)} placeholder="备忘内容…" />
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "保存中…" : isEdit ? "保存" : "添加"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => nav(`/novels/${id}/memos`)}>
            取消
          </button>
        </div>
      </form>
    </div>
  );
}
