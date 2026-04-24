import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiErrorMessage, createMemo, fetchMemos, updateMemo } from "@/api/client";

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

export default function NovelMemoForm() {
  const { novelId, memoId } = useParams();
  const id = Number(novelId);
  const mid = memoId ? Number(memoId) : NaN;
  const isEdit = Number.isFinite(mid);
  const nav = useNavigate();

  const [loading, setLoading] = useState(isEdit);
  const [errorMsg, setErrorMsg] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      setErrorMsg("");
      try {
        const list = await fetchMemos(id);
        const m = list.find((x) => x.id === mid);
        if (!m) {
          setErrorMsg("找不到该备忘");
          return;
        }
        setTitle(m.title);
        setBody(m.body);
      } catch (e) {
        setErrorMsg(apiErrorMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id, mid, isEdit]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg("");
    setSaving(true);
    try {
      if (isEdit) {
        await updateMemo(id, mid, { title, body });
      } else {
        await createMemo(id, { title, body });
      }
      nav(`/novels/${id}/memos`);
    } catch (e) {
      setErrorMsg(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="form-container">
        <div className="card card--enhanced">
          <div style={{ display: "flex", justifyContent: "center", padding: "4rem 2rem" }}>
            <div className="btn__spinner" style={{ borderColor: "var(--muted)", borderTopColor: "transparent", width: "1.25rem", height: "1.25rem" }} />
            <span className="muted" style={{ marginLeft: "0.75rem", fontSize: "0.95rem" }}>加载备忘信息…</span>
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
            <h2 className="card__title">{isEdit ? "编辑备忘" : "新建备忘"}</h2>
            <span className={`badge ${isEdit ? "badge--info" : "badge--warning"}`}>
              {isEdit ? "编辑模式" : "新建模式"}
            </span>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => nav(`/novels/${id}/memos`)}>
            <span>←</span>
            返回列表
          </button>
        </div>

        <form onSubmit={onSubmit}>
          <div className="card__body">
            {errorMsg ? (
              <div className="alert alert--error">
                <span className="alert__icon">✕</span>
                <div className="alert__content">
                  <p className="alert__title">操作失败</p>
                  <p style={{ margin: 0 }}>{errorMsg}</p>
                </div>
              </div>
            ) : null}

            <div className="field-group">
              <h3 className="field-group__title">备忘信息</h3>

              <div className="field">
                <label htmlFor="memo-title">
                  <span className="label-text">
                    标题
                    <span className="label--optional">（可选）</span>
                  </span>
                  <Tooltip content="标题用于快速识别备忘内容。如果不填，系统会自动使用正文的前几个字符作为标题">
                    <HelpIcon />
                  </Tooltip>
                </label>
                <input
                  id="memo-title"
                  className="input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="简要描述备忘的内容"
                />
              </div>

              <div className="field">
                <label htmlFor="memo-body">
                  <span className="label-text">
                    正文
                    <span className="label--required">*</span>
                  </span>
                  <Tooltip content="备忘内容可以是任何你想记录的信息：灵感、设定、剧情线索、参考资料等">
                    <HelpIcon />
                  </Tooltip>
                </label>
                <textarea
                  id="memo-body"
                  className="textarea"
                  rows={14}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="记录你的备忘内容…

备忘可以用于：
- 记录灵感和想法
- 保存重要的设定细节
- 记录剧情线索和伏笔
- 保存参考资料和素材"
                />
              </div>
            </div>

            <div className="alert alert--info">
              <span className="alert__icon">ℹ</span>
              <div className="alert__content">
                <p className="alert__title">备忘的用途</p>
                <p style={{ margin: 0 }}>
                  备忘是你创作时的得力助手。你可以用它来记录灵感、保存设定细节、追踪剧情线索，或者存放任何对你有帮助的参考资料。
                </p>
              </div>
            </div>

            <div className="alert alert--warning">
              <span className="alert__icon">⚠</span>
              <div className="alert__content">
                <p className="alert__title">小提示</p>
                <p style={{ margin: 0 }}>
                  建议定期整理你的备忘，删除不再需要的内容，保持备忘列表的整洁和高效。
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
                  {isEdit ? "保存修改" : "添加备忘"}
                </>
              )}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => nav(`/novels/${id}/memos`)}
              disabled={saving}
            >
              取消
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
