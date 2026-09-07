import { useEffect, useRef, useState } from "react";
import { Button, Select, Tooltip } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { probeTransportError } from "@/utils/probeError";
import { useI18n } from "@/i18n";
import type { LlmProbeMode, LlmProbeResult } from "@/api/client";

export default function LlmProbeControls({ run, revision, disabled, modelDisabled, onModel, onModels }: {
  run: (mode: LlmProbeMode) => Promise<LlmProbeResult>;
  revision: unknown; disabled?: boolean; modelDisabled?: boolean;
  onModel?: (model: string) => void; onModels?: (models: string[]) => void;
}) {
  const { t } = useI18n();
  const [results, setResults] = useState<Partial<Record<LlmProbeMode, LlmProbeResult>>>({});
  const [busy, setBusy] = useState<LlmProbeMode | null>(null);
  const version = useRef(0);
  const inFlight = useRef(false);
  useEffect(() => { version.current++; setResults({}); return () => { version.current++; }; }, [revision]);
  const check = async (mode: LlmProbeMode) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const current = version.current;
    setBusy(mode);
    try {
      const result = await run(mode);
      if (current === version.current) {
        setResults((previous) => ({ ...previous, [mode]: result }));
        if (mode === "models" && result.status === "ok") onModels?.(result.models);
      }
    } catch (error) {
      if (current === version.current) setResults((previous) => ({ ...previous, [mode]: probeTransportError(error, mode) }));
    } finally { inFlight.current = false; setBusy(null); }
  };
  return <div className="llm-probe-inline">
    <div className="llm-probe-actions">
      <Button type="text" icon={<ReloadOutlined />} loading={busy === "models"} disabled={disabled || !!busy}
        onClick={() => void check("models")}>{t("llm_refresh_models")}</Button>
      <Tooltip title={modelDisabled ? t("llm_save_before_test") : t("llm_probe_cost")}>
        <span><Button loading={busy === "model"} disabled={disabled || modelDisabled || !!busy}
          onClick={() => void check("model")}>{t("llm_probe_model")}</Button></span>
      </Tooltip>
      <span className="llm-probe-note">{t("llm_test_cost_short")}</span>
    </div>
    {(["models", "model"] as const).map((mode) => {
      const result = results[mode];
      if (!result) return null;
      const ok = result.status === "ok";
      const label = ok ? mode === "models"
        ? t("llm_list_count").replace("{count}", String(result.models.length)) : t("llm_request_ok")
        : mode === "models" && result.status === "not_supported" ? t("llm_list_unavailable") : t("llm_request_failed");
      return <div key={mode} className="llm-probe-result">
        <span role="status" className={ok ? "is-success" : "is-warning"}>{label}
          {mode === "model" && result.elapsed_ms != null && ` · ${t("llm_total_duration")} ${(result.elapsed_ms / 1000).toFixed(2)} ${t("llm_seconds")}`}
        </span>
        {(!ok || mode === "model") && <details><summary>{t("llm_details")}</summary>
          <p>{t(ok ? "llm_probe_model_ok" : `llm_probe_${result.status}`)}{result.http_status ? ` (HTTP ${result.http_status})` : ""}</p>
        </details>}
        {mode === "models" && ok && onModel && result.models.length > 0 && <Select showSearch
          aria-label={t("ai_settings_model")} placeholder={t("llm_compact_placeholder")}
          style={{ width: "100%" }} options={result.models.map(value => ({ value, label: value }))} onChange={onModel} />}
      </div>;
    })}
  </div>;
}
