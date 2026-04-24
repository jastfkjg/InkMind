import { useEffect, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { apiErrorMessage, updateNovel } from "@/api/client";
import type { Novel } from "@/types";

type Ctx = { novel: Novel | null; setNovel: React.Dispatch<React.SetStateAction<Novel | null>> };

function Tooltip({ children, content }: { children: React.ReactNode; content: string }) {
  return (
    <div className="tooltip tooltip--bottom">
      {children}
      <div className="tooltip__content">{content}</div>
    </div>
  );
}

function HelpIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="tooltip__trigger"
    >
      <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.25" fill="none" />
      <path
        d="M7 3.8C7.55228 3.8 8 4.24772 8 4.8C8 5.35228 7.55228 5.8 7 5.8C6.44772 5.8 6 5.35228 6 4.8C6 4.24772 6.44772 3.8 7 3.8Z"
        fill="currentColor"
      />
      <path
        d="M7 7.5V10.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function NovelSettings() {
  const { novelId } = useParams();
  const id = Number(novelId);
  const { novel, setNovel } = useOutletContext<Ctx>();
  const [title, setTitle] = useState("");
  const [background, setBackground] = useState("");
  const [genre, setGenre] = useState("");
  const [writingStyle, setWritingStyle] = useState("");
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!novel) return;
    setTitle(novel.title);
    setBackground(novel.background);
    setGenre(novel.genre);
    setWritingStyle(novel.writing_style);
  }, [novel]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");
    setSaving(true);
    try {
      const n = await updateNovel(id, { title, background, genre, writing_style: writingStyle });
      setNovel(n);
      setSuccessMsg("作品设定已保存");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (e) {
      setErrorMsg(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (!novel) {
    return (
      <div className="form-container">
        <div className="card card--enhanced">
          <div style={{ display: "flex", justifyContent: "center", padding: "4rem 2rem" }}>
            <div className="btn__spinner" style={{ borderColor: "var(--muted)", borderTopColor: "transparent", width: "1.25rem", height: "1.25rem" }} />
            <span className="muted" style={{ marginLeft: "0.75rem", fontSize: "0.95rem" }}>加载作品信息…</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="form-container">
      <div className="card card--enhanced card--elevated">
        <div className="card__header">
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <h2 className="card__title">作品设定</h2>
            <span className="badge badge--muted">管理作品的基础信息</span>
          </div>
        </div>

        <form onSubmit={onSave}>
          <div className="card__body">
            {successMsg ? (
              <div className="alert alert--success">
                <span className="alert__icon">✓</span>
                <div className="alert__content">
                  <p className="alert__title">保存成功</p>
                  <p style={{ margin: 0 }}>{successMsg}</p>
                </div>
              </div>
            ) : null}

            {errorMsg ? (
              <div className="alert alert--error">
                <span className="alert__icon">✕</span>
                <div className="alert__content">
                  <p className="alert__title">保存失败</p>
                  <p style={{ margin: 0 }}>{errorMsg}</p>
                </div>
              </div>
            ) : null}

            <div className="field-group">
              <h3 className="field-group__title">基本信息</h3>

              <div className="field">
                <label htmlFor="title">
                  <span className="label-text">
                    作品名称
                    <span className="label--required">*</span>
                  </span>
                  <Tooltip content="这是你的小说的标题，会显示在作品列表中">
                    <HelpIcon />
                  </Tooltip>
                </label>
                <input
                  id="title"
                  className="input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="输入作品名称"
                />
              </div>

              <div className="field">
                <label htmlFor="genre">
                  <span className="label-text">
                    类型
                  </span>
                  <Tooltip content="帮助 AI 更好地理解你的创作风格">
                    <HelpIcon />
                  </Tooltip>
                </label>
                <input
                  id="genre"
                  className="input"
                  placeholder="例如：科幻、武侠、言情、悬疑…"
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                />
              </div>
            </div>

            <div className="field-group">
              <h3 className="field-group__title">创作风格与背景</h3>

              <div className="field">
                <label htmlFor="ws">
                  <span className="label-text">
                    写作风格
                  </span>
                  <Tooltip content="描述你希望的写作风格，AI 会参考这些信息进行创作">
                    <HelpIcon />
                  </Tooltip>
                </label>
                <textarea
                  id="ws"
                  className="textarea textarea-compact"
                  rows={2}
                  placeholder="例如：第三人称、细腻心理描写、节奏偏慢、幽默风格…"
                  value={writingStyle}
                  onChange={(e) => setWritingStyle(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="background">
                  <span className="label-text">
                    背景设定
                  </span>
                  <Tooltip content="这是 AI 生成内容时的重要参考。简洁明了地描述故事发生的世界">
                    <HelpIcon />
                  </Tooltip>
                </label>
                <textarea
                  id="background"
                  className="textarea"
                  placeholder="例如：时代、地点、世界观、核心矛盾…（宜短，不必写全书大纲）"
                  value={background}
                  onChange={(e) => setBackground(e.target.value)}
                  rows={3}
                />
              </div>
            </div>

            <div className="alert alert--info">
              <span className="alert__icon">ℹ</span>
              <div className="alert__content">
                <p className="alert__title">小提示</p>
                <p style={{ margin: 0 }}>
                  完善的作品设定可以帮助 AI 生成更符合你期望的内容。建议至少填写作品类型和简要的背景设定。
                </p>
              </div>
            </div>
          </div>

          <div className="card__footer card__footer--actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? (
                <>
                  <span className="btn__spinner" />
                  保存中…
                </>
              ) : (
                <>
                  <span>✓</span>
                  保存设定
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
