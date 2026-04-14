import { useEffect, useRef, useState } from "react";
import { apiErrorMessage, fetchLlmProviders, novelAiChat, novelAiNaming } from "@/api/client";

type Tool = "naming" | "ask";

const RAIL: { key: Tool; line2: string }[] = [
  { key: "naming", line2: "起名" },
  { key: "ask", line2: "提问" },
];

type Props = {
  novelId: number;
};

export default function NovelAiNamingAskDock({ novelId }: Props) {
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
      setErr("请说明要命名的对象");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const { text } = await novelAiNaming(novelId, {
        category: namingCategory,
        description: d,
        hint: namingHint || null,
      });
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
    try {
      const prior = askHistory.map((m) => ({ role: m.role, content: m.content }));
      const { reply } = await novelAiChat(novelId, {
        message: q,
        history: prior,
      });
      setAskHistory((h) => [
        ...h,
        { role: "user", content: q },
        { role: "assistant", content: reply },
      ]);
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const drawerOpen = rightTool && hasLlm;

  return (
    <>
      <nav className="write-ai-rail" aria-label="AI 功能">
        {RAIL.map(({ key, line2 }) => (
          <button
            key={key}
            type="button"
            className={`write-rail-btn${rightTool === key ? " active" : ""}`}
            disabled={!hasLlm}
            title={!hasLlm ? "未配置 LLM" : `AI${line2}`}
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
            <span>{rightTool === "naming" ? "AI 起名" : "AI 提问"}</span>
            <button type="button" className="write-ai-close btn btn-ghost" onClick={() => setRightTool(null)}>
              关闭
            </button>
          </div>
          <div className="write-ai-drawer-body">
            {err ? <p className="form-error" style={{ marginTop: 0 }}>{err}</p> : null}

            {rightTool === "naming" ? (
              <div className="write-ai-section">
                <p className="hint">为人物、物品、功法等请求备选名称（非章节标题）。</p>
                <div className="field">
                  <label>类别</label>
                  <select
                    className="input"
                    value={namingCategory}
                    onChange={(e) => setNamingCategory(e.target.value as typeof namingCategory)}
                  >
                    <option value="character">人物 / 角色</option>
                    <option value="item">物品 / 器物</option>
                    <option value="skill">功法 / 招式</option>
                    <option value="other">其他</option>
                  </select>
                </div>
                <div className="field">
                  <label>要命名的对象</label>
                  <textarea
                    className="textarea"
                    rows={3}
                    value={namingDesc}
                    onChange={(e) => setNamingDesc(e.target.value)}
                    placeholder="例如：擅长用毒的黑市药师；上古飞剑；火系入门功法…"
                  />
                </div>
                <div className="field">
                  <label>补充（可选）</label>
                  <textarea
                    className="textarea textarea-compact"
                    rows={2}
                    value={namingHint}
                    onChange={(e) => setNamingHint(e.target.value)}
                    placeholder="字数、风格、避讳…"
                  />
                </div>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={onRunNaming}>
                  {busy ? "生成中…" : "生成备选名"}
                </button>
                {namingResult ? <pre className="write-ai-naming-out">{namingResult}</pre> : null}
              </div>
            ) : null}

            {rightTool === "ask" ? (
              <div className="write-ai-chat">
                <div className="write-ai-messages">
                  {askHistory.length === 0 ? (
                    <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
                      围绕本书设定提问，例如结构、人物、节奏等。
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
                    placeholder="输入问题…"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        onAskSend();
                      }
                    }}
                  />
                  <button type="button" className="btn btn-primary" disabled={busy || !askInput.trim()} onClick={onAskSend}>
                    发送
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
