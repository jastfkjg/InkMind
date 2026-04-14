import { useEffect, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { apiErrorMessage, updateNovel } from "@/api/client";
import type { Novel } from "@/types";

type Ctx = { novel: Novel | null; setNovel: React.Dispatch<React.SetStateAction<Novel | null>> };

export default function NovelSettings() {
  const { novelId } = useParams();
  const id = Number(novelId);
  const { novel, setNovel } = useOutletContext<Ctx>();
  const [title, setTitle] = useState("");
  const [background, setBackground] = useState("");
  const [genre, setGenre] = useState("");
  const [writingStyle, setWritingStyle] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!novel) return;
    setTitle(novel.title);
    setBackground(novel.background);
    setGenre(novel.genre);
    setWritingStyle(novel.writing_style);
  }, [novel]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setMsg("");
    setSaving(true);
    try {
      const n = await updateNovel(id, { title, background, genre, writing_style: writingStyle });
      setNovel(n);
      setMsg("已保存");
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (!novel) {
    return <p className="muted">加载作品信息…</p>;
  }

  return (
    <div className="card" style={{ maxWidth: 720 }}>
      <h2 style={{ fontFamily: "var(--font-serif)", marginTop: 0 }}>作品设定</h2>
      <form onSubmit={onSave}>
        <div className="field">
          <label htmlFor="title">作品名称</label>
          <input id="title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="genre">类型</label>
          <input
            id="genre"
            className="input"
            placeholder="例如：科幻、武侠、言情…"
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="ws">写作风格</label>
          <textarea
            id="ws"
            className="textarea textarea-compact"
            rows={2}
            placeholder="例如：第三人称、细腻心理描写、节奏偏慢…"
            value={writingStyle}
            onChange={(e) => setWritingStyle(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="background">背景</label>
          <textarea
            id="background"
            className="textarea"
            placeholder="例如：时代、地点、世界观、核心矛盾…（宜短，不必写全书大纲）"
            value={background}
            onChange={(e) => setBackground(e.target.value)}
            rows={2}
          />
        </div>
        {err ? <p className="form-error">{err}</p> : null}
        {msg ? <p className="muted">{msg}</p> : null}
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "保存中…" : "保存设定"}
        </button>
      </form>
    </div>
  );
}
