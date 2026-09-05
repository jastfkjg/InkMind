import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiErrorMessage, fetchLlmProviders, isDesktopApp } from "@/api/client";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/i18n";
import type { LlmProvidersResponse } from "@/types";

export default function UserMenu() {
  const { t } = useI18n();
  const { user, logout, updatePreferredLlm, refreshUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [providerInfo, setProviderInfo] = useState<LlmProvidersResponse | null>(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchLlmProviders()
      .then((m) => setProviderInfo(m))
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

  const hasCustomGen = !!user?.generation_use_custom && !!user?.generation_custom_llm_id;
  const hasCustomAgent = !!user?.agent_use_custom && !!user?.agent_custom_llm_id;
  const builtinProviders = providerInfo?.builtin || [];
  const defaultProvider = providerInfo?.default || "";

  const current =
    user?.preferred_llm_provider && builtinProviders.some((p) => p.id === user.preferred_llm_provider)
      ? user.preferred_llm_provider
      : builtinProviders.some((p) => p.id === defaultProvider)
        ? defaultProvider
        : builtinProviders[0]?.id || "";

  return (
    <div className="user-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className="btn btn-ghost user-menu-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {user?.display_name || user?.email || t("usermenu_user")}
        <span className="user-menu-caret" aria-hidden>▾</span>
      </button>
      {open ? (
        <div className="user-menu-dropdown card" role="menu">
          <div className="user-menu-email muted">
            {isDesktopApp ? t("usermenu_local_data") : user?.email}
          </div>

          {hasCustomAgent && (
            <div style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "var(--muted)" }}>
              🤖 {t("usermenu_agent_configured")} <span style={{ opacity: 0.7 }}>({t("ai_settings_custom_tag")})</span>
            </div>
          )}
          {!hasCustomAgent && builtinProviders.some((p) => p.id === "anthropic") && (
            <div style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "var(--muted)" }}>
              🤖 {t("usermenu_agent_builtin")}
            </div>
          )}

          {hasCustomGen && (
            <div style={{ marginTop: "0.25rem", fontSize: "0.85rem", color: "var(--muted)" }}>
              ✍️ {t("usermenu_generation_configured")} <span style={{ opacity: 0.7 }}>({t("ai_settings_custom_tag")})</span>
            </div>
          )}

          {!hasCustomGen && builtinProviders.length > 0 && (
            <div className="field" style={{ marginBottom: 0, marginTop: "0.75rem" }}>
              <label htmlFor="menu-llm">{t("usermenu_default_llm")}</label>
              <select
                id="menu-llm"
                className="input"
                value={current}
                disabled={saving}
                onChange={(e) => onPickLlm(e.target.value)}
              >
                {builtinProviders.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              <p className="hint" style={{ marginBottom: 0 }}>
                {t("usermenu_llm_hint")}
              </p>
            </div>
          )}

          {!hasCustomGen && builtinProviders.length === 0 && (
            <p className="hint" style={{ marginTop: "0.75rem" }}>
              {t("usermenu_no_llm_configured")}
            </p>
          )}

          {err ? <p className="form-error" style={{ marginTop: "0.5rem" }}>{err}</p> : null}
          <Link
            to="/settings"
            className="btn btn-ghost"
            style={{ width: "100%", marginTop: "0.75rem" }}
            onClick={() => setOpen(false)}
          >
            {t("nav_ai_settings")}
          </Link>
          <Link
            to="/usage"
            className="btn btn-ghost"
            style={{ width: "100%", marginTop: "0.75rem" }}
            onClick={() => setOpen(false)}
          >
            {t("usermenu_token_usage")}
          </Link>
          {!isDesktopApp ? (
            <button type="button" className="btn btn-ghost" style={{ width: "100%", marginTop: "0.75rem" }} onClick={logout}>
              {t("usermenu_logout")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
