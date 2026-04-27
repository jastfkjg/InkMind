import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiErrorMessage, fetchLlmProviders } from "@/api/client";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/i18n";

const LLM_LABEL: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  qwen: "qwen",
  deepseek: "DeepSeek",
  minimax: "MiniMax",
  kimi: "Kimi",
};

function llmLabel(id: string, t: (key: string) => string) {
  const label = LLM_LABEL[id];
  if (label === "qwen") {
    return t("usermenu_model_qwen");
  }
  return label ?? id;
}

export default function UserMenu() {
  const { t } = useI18n();
  const { user, logout, updatePreferredLlm, refreshUser } = useAuth();
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
    if (open) void refreshUser();
  }, [open, refreshUser]);

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
        {user?.display_name || user?.email || t("usermenu_user")}
        <span className="user-menu-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div className="user-menu-dropdown card" role="menu">
          <div className="user-menu-email muted">{user?.email}</div>

          {llmOptions.length > 0 ? (
            <div className="field" style={{ marginBottom: 0, marginTop: "0.75rem" }}>
              <label htmlFor="menu-llm">{t("usermenu_default_llm")}</label>
              <select
                id="menu-llm"
                className="input"
                value={current}
                disabled={saving}
                onChange={(e) => onPickLlm(e.target.value)}
              >
                {llmOptions.map((o) => (
                  <option key={o} value={o}>
                    {llmLabel(o, t)}
                  </option>
                ))}
              </select>
              <p className="hint" style={{ marginBottom: 0 }}>
                {t("usermenu_llm_hint")}
              </p>
            </div>
          ) : (
            <p className="hint" style={{ marginTop: "0.75rem" }}>
              {t("usermenu_no_llm_configured")}
            </p>
          )}
          {err ? <p className="form-error" style={{ marginTop: "0.5rem" }}>{err}</p> : null}
          <Link
            to="/usage"
            className="btn btn-ghost"
            style={{ width: "100%", marginTop: "0.75rem" }}
            onClick={() => setOpen(false)}
          >
            {t("usermenu_token_usage")}
          </Link>
          <button type="button" className="btn btn-ghost" style={{ width: "100%", marginTop: "0.75rem" }} onClick={logout}>
            {t("usermenu_logout")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
