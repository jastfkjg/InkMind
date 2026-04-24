import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import NovelAiNamingAskDock from "@/components/NovelAiNamingAskDock";
import { apiErrorMessage, createCharacter, fetchCharacters, updateCharacter } from "@/api/client";

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

export default function NovelPeopleForm() {
  const { novelId, characterId } = useParams();
  const id = Number(novelId);
  const cid = characterId ? Number(characterId) : NaN;
  const isEdit = Number.isFinite(cid);
  const nav = useNavigate();

  const [loading, setLoading] = useState(isEdit);
  const [errorMsg, setErrorMsg] = useState("");
  const [name, setName] = useState("");
  const [profile, setProfile] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      setErrorMsg("");
      try {
        const list = await fetchCharacters(id);
        const c = list.find((x) => x.id === cid);
        if (!c) {
          setErrorMsg("找不到该人物");
          return;
        }
        setName(c.name);
        setProfile(c.profile);
        setNotes(c.notes);
      } catch (e) {
        setErrorMsg(apiErrorMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id, cid, isEdit]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg("");
    setSaving(true);
    try {
      if (isEdit) {
        await updateCharacter(id, cid, { name, profile, notes });
      } else {
        await createCharacter(id, { name, profile, notes });
      }
      nav(`/novels/${id}/people`);
    } catch (e) {
      setErrorMsg(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="write-shell write-shell--form">
        <div className="card card--enhanced">
          <div style={{ display: "flex", justifyContent: "center", padding: "4rem 2rem" }}>
            <div className="btn__spinner" style={{ borderColor: "var(--muted)", borderTopColor: "transparent", width: "1.25rem", height: "1.25rem" }} />
            <span className="muted" style={{ marginLeft: "0.75rem", fontSize: "0.95rem" }}>加载人物信息…</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="write-shell write-shell--form">
      <div className="card card--enhanced card--elevated">
        <div className="card__header">
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <h2 className="card__title">{isEdit ? "编辑人物" : "新建人物"}</h2>
            <span className={`badge ${isEdit ? "badge--info" : "badge--primary"}`}>
              {isEdit ? "编辑模式" : "新建模式"}
            </span>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => nav(`/novels/${id}/people`)}>
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
              <h3 className="field-group__title">基本信息</h3>

              <div className="field">
                <label htmlFor="char-name">
                  <span className="label-text">
                    人物姓名
                    <span className="label--required">*</span>
                  </span>
                  <Tooltip content="这是人物的核心标识，AI 会在生成内容时参考这个名字">
                    <HelpIcon />
                  </Tooltip>
                </label>
                <input
                  id="char-name"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：林清风、叶听雨…"
                  required
                />
              </div>
            </div>

            <div className="field-group">
              <h3 className="field-group__title">人物设定</h3>

              <div className="field">
                <label htmlFor="char-profile">
                  <span className="label-text">
                    性格与设定
                    <span className="label--optional">（可选）</span>
                  </span>
                  <Tooltip content="详细描述人物的性格、外貌、背景、习惯等。这是 AI 保持人物一致性的关键参考">
                    <HelpIcon />
                  </Tooltip>
                </label>
                <textarea
                  id="char-profile"
                  className="textarea"
                  rows={5}
                  placeholder="例如：
- 性格：冷静理智，外冷内热
- 外貌：黑发黑眸，气质清冷
- 背景：出身书香门第，自幼饱读诗书
- 习惯：思考时喜欢轻敲桌面

越详细的设定，AI 生成的人物形象越一致。"
                  value={profile}
                  onChange={(e) => setProfile(e.target.value)}
                />
              </div>
            </div>

            <div className="field-group">
              <h3 className="field-group__title">补充信息</h3>

              <div className="field">
                <label htmlFor="char-notes">
                  <span className="label-text">
                    其他描述
                    <span className="label--optional">（可选）</span>
                  </span>
                  <Tooltip content="用于记录人物的补充信息，如人际关系、隐藏身份、口头禅等">
                    <HelpIcon />
                  </Tooltip>
                </label>
                <textarea
                  id="char-notes"
                  className="textarea"
                  rows={3}
                  placeholder="例如：
- 与主角的关系：青梅竹马
- 隐藏身份：某个神秘组织的成员
- 口头禅：'凡事都有代价。'

可以记录任何你不想放在主要设定中的补充信息。"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>

            <div className="alert alert--info">
              <span className="alert__icon">ℹ</span>
              <div className="alert__content">
                <p className="alert__title">小提示</p>
                <p style={{ margin: 0 }}>
                  完善的人物设定可以帮助 AI 生成更一致、更生动的角色形象。建议至少填写人物的核心性格特征。
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
                  {isEdit ? "保存修改" : "添加人物"}
                </>
              )}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => nav(`/novels/${id}/people`)}
              disabled={saving}
            >
              取消
            </button>
          </div>
        </form>
      </div>

      <NovelAiNamingAskDock novelId={id} />
    </div>
  );
}
