import { useEffect, useRef, useState } from "react";
import { apiErrorMessage, fetchLlmProviders } from "@/api/client";
import { useAuth } from "@/context/AuthContext";

const LLM_LABEL: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  qwen: "通义千问",
  deepseek: "DeepSeek",
};

function llmLabel(id: string) {
  return LLM_LABEL[id] ?? id;
}

export default function UserMenu() {
  const { user, logout, updatePreferredLlm } = useAuth();
  const [open, setOpen] = useState(false);
  const [llmOptions, setLlmOptions] = useState<string[]>([]);
  const [defaultLlm, setDefaultLlm] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchLlmProviders()
      .then((m) => {
        setLlmOptions(m.available);
        setDefaultLlm(m.default);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  async function onPickLlm(value: string) {
    setErr("");
    setSaving(true);
    try {
      await updatePreferredLlm(value || null);
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const current =
    user?.preferred_llm_provider && llmOptions.includes(user.preferred_llm_provider)
      ? user.preferred_llm_provider
      : llmOptions.includes(defaultLlm)
        ? defaultLlm
        : llmOptions[0] || "";

  return (
    <div className="user-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className="btn btn-ghost user-menu-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {user?.display_name || user?.email || "用户"}
        <span className="user-menu-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div className="user-menu-dropdown card" role="menu">
          <div className="user-menu-email muted">{user?.email}</div>
          {llmOptions.length > 0 ? (
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="menu-llm">默认模型</label>
              <select
                id="menu-llm"
                className="input"
                value={current}
                disabled={saving}
                onChange={(e) => onPickLlm(e.target.value)}
              >
                {llmOptions.map((o) => (
                  <option key={o} value={o}>
                    {llmLabel(o)}
                  </option>
                ))}
              </select>
              <p className="hint" style={{ marginBottom: 0 }}>
                用于生成、修改章节与自动摘要
              </p>
            </div>
          ) : (
            <p className="hint" style={{ marginTop: 0 }}>
              未配置任何 LLM，请在服务端环境变量中设置 API Key
            </p>
          )}
          {err ? <p className="form-error" style={{ marginTop: "0.5rem" }}>{err}</p> : null}
          <button type="button" className="btn btn-ghost" style={{ width: "100%", marginTop: "0.75rem" }} onClick={logout}>
            退出登录
          </button>
        </div>
      ) : null}
    </div>
  );
}
