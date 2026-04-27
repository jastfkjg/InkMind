import { useEffect, useMemo, useRef, useState } from "react";
import { apiErrorMessage, fetchLlmProviders, novelAiChat, novelAiNaming } from "@/api/client";
import { useI18n } from "@/i18n";

type Tool = "naming" | "ask";

type Props = {
  novelId: number;
};

export default function NovelAiNamingAskDock({ novelId }: Props) {
  const { t } = useI18n();
  
  const RAIL: { key: Tool; line2: string }[] = useMemo(() => [
    { key: "naming", line2: t("namingask_naming") },
    { key: "ask", line2: t("namingask_ask") },
  ], [t]);
  
  const [llmOptions, setLlmOptions] = useState<string[]>([]);
  const [rightTool, setRightTool] = useState<Tool | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [namingCategory, setNamingCategory] = useState<"character" | "item" | "skill" | "other">("character");
  const [namingDesc, setNamingDesc] = useState("");
  const [namingHint, setNamingHint] = useState("");
  const [namingResult, setNamingResult] = useState("");
  const [askHistory, setAskHistory] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [askInput, setAskInput] = useState("");
  const drawerEndRef = useRef<HTMLDivElement | null>(null);

  const hasLlm = llmOptions.length > 0;

  useEffect(() => {
    (async () => {
      try {
        const meta = await fetchLlmProviders();
        setLlmOptions(meta.available);
      } catch {
        setLlmOptions([]);
      }
    })();
  }, []);

  useEffect(() => {
    setAskHistory([]);
    setAskInput("");
    setNamingResult("");
    setRightTool(null);
  }, [novelId]);

  useEffect(() => {
    drawerEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [askHistory, rightTool]);

  function toggleTool(t: Tool) {
    if (!hasLlm) return;
    setErr("");
    setRightTool((prev) => (prev === t ? null : t));
  }

  async function onRunNaming() {
    const d = namingDesc.trim();
    if (!d) {
      setErr(t("namingask_please_describe"));
      return;
    }
    setBusy(true);
    setErr("");
    try {
      setNamingResult("");
      const { text } = await novelAiNaming(
        novelId,
        {
          category: namingCategory,
          description: d,
          hint: namingHint || null,
        },
        (t) => setNamingResult((prev) => prev + t)
      );
      setNamingResult(text);
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onAskSend() {
    const q = askInput.trim();
    if (!q) return;
    setBusy(true);
    setErr("");
    setAskInput("");
    const prior = askHistory.map((m) => ({ role: m.role, content: m.content }));
    setAskHistory((h) => [...h, { role: "user", content: q }, { role: "assistant", content: "" }]);
    let acc = "";
    try {
      await novelAiChat(
        novelId,
        {
          message: q,
          history: prior,
        },
        (t) => {
          acc += t;
          setAskHistory((h) => {
            const copy = [...h];
            const last = copy[copy.length - 1];
            if (last?.role === "assistant") {
              copy[copy.length - 1] = { role: "assistant", content: acc };
            }
            return copy;
          });
        }
      );
    } catch (e) {
      setErr(apiErrorMessage(e));
      setAskHistory((h) => {
        if (h.length < 2) return h;
        const copy = [...h];
        copy.pop();
        copy.pop();
        return copy;
      });
      setAskInput(q);
    } finally {
      setBusy(false);
    }
  }

  const drawerOpen = rightTool && hasLlm;

  return (
    <>
      <nav className="write-ai-rail" aria-label={t("write_rail_aria_ai_tools")}>
        {RAIL.map(({ key, line2 }) => (
          <button
            key={key}
            type="button"
            className={`write-rail-btn${rightTool === key ? " active" : ""}`}
            disabled={!hasLlm}
            title={!hasLlm ? t("namingask_no_llm") : `AI${line2}`}
            onClick={() => toggleTool(key)}
          >
            <span className="write-rail-stack">
              <span className="write-rail-ai">AI</span>
              <span className="write-rail-name">{line2}</span>
            </span>
          </button>
        ))}
      </nav>

      {drawerOpen && rightTool ? (
        <div className="write-ai-drawer">
          <div className="write-ai-drawer-head">
            <span>{rightTool === "naming" ? t("namingask_ai_naming") : t("namingask_ai_ask")}</span>
            <button type="button" className="write-ai-close btn btn-ghost" onClick={() => setRightTool(null)}>
              {t("namingask_close")}
            </button>
          </div>
          <div className="write-ai-drawer-body">
            {err ? <p className="form-error" style={{ marginTop: 0 }}>{err}</p> : null}

            {rightTool === "naming" ? (
              <div className="write-ai-section">
                <p className="hint">{t("namingask_naming_hint")}</p>
                <div className="field">
                  <label>{t("namingask_category")}</label>
                  <select
                    className="input"
                    value={namingCategory}
                    onChange={(e) => setNamingCategory(e.target.value as typeof namingCategory)}
                  >
                    <option value="character">{t("namingask_cat_character")}</option>
                    <option value="item">{t("namingask_cat_item")}</option>
                    <option value="skill">{t("namingask_cat_skill")}</option>
                    <option value="other">{t("namingask_cat_other")}</option>
                  </select>
                </div>
                <div className="field">
                  <label>{t("namingask_target_label")}</label>
                  <textarea
                    className="textarea"
                    rows={3}
                    value={namingDesc}
                    onChange={(e) => setNamingDesc(e.target.value)}
                    placeholder={t("namingask_target_placeholder")}
                  />
                </div>
                <div className="field">
                  <label>{t("namingask_hint_label")}</label>
                  <textarea
                    className="textarea textarea-compact"
                    rows={2}
                    value={namingHint}
                    onChange={(e) => setNamingHint(e.target.value)}
                    placeholder={t("namingask_hint_placeholder")}
                  />
                </div>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={onRunNaming}>
                  {busy ? t("namingask_generating") : t("namingask_generate_names")}
                </button>
                {namingResult ? <pre className="write-ai-naming-out">{namingResult}</pre> : null}
              </div>
            ) : null}

            {rightTool === "ask" ? (
              <div className="write-ai-chat">
                <div className="write-ai-messages">
                  {askHistory.length === 0 ? (
                    <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
                      {t("namingask_ask_hint")}
                    </p>
                  ) : (
                    askHistory.map((m, i) => (
                      <div
                        key={i}
                        className={`write-ai-bubble${m.role === "user" ? " write-ai-bubble--user" : ""}`}
                      >
                        {m.content}
                      </div>
                    ))
                  )}
                  <div ref={drawerEndRef} />
                </div>
                <div className="write-ai-chat-input">
                  <textarea
                    className="textarea textarea-compact"
                    rows={2}
                    value={askInput}
                    onChange={(e) => setAskInput(e.target.value)}
                    placeholder={t("namingask_input_placeholder")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        onAskSend();
                      }
                    }}
                  />
                  <button type="button" className="btn btn-primary" disabled={busy || !askInput.trim()} onClick={onAskSend}>
                    {t("namingask_send")}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
