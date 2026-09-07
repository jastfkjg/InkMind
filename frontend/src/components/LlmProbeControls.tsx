import { useEffect, useRef, useState } from "react";
import { Button, Space, Typography } from "antd";
import { probeTransportError } from "@/utils/probeError";
import { useI18n } from "@/i18n";
import type { LlmProbeMode, LlmProbeResult } from "@/api/client";

export default function LlmProbeControls({ run, revision, disabled, onModel }: {
  run: (mode: LlmProbeMode) => Promise<LlmProbeResult>;
  revision: unknown; disabled?: boolean; onModel?: (model: string) => void;
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
      if (current === version.current) setResults((previous) => ({ ...previous, [mode]: result }));
    } catch (error) {
      if (current === version.current) setResults((previous) => ({ ...previous, [mode]: probeTransportError(error, mode) }));
    } finally { inFlight.current = false; setBusy(null); }
  };
  return <Space orientation="vertical" style={{ width: "100%" }}>
    <Space wrap>
      {(["models", "model"] as const).map((mode) => <Button key={mode} loading={busy === mode}
        disabled={disabled || !!busy} onClick={() => void check(mode)}>{t(`llm_probe_${mode}`)}</Button>)}
    </Space>
    <Typography.Text type="secondary">{t("llm_probe_cost")}</Typography.Text>
    {(["models", "model"] as const).map((mode) => {
      const result = results[mode];
      return result && <div key={mode} role="status">
        <Typography.Text type={result.status === "ok" ? "success" : "warning"}>
          {t(`llm_probe_${mode}`)}：{t(result.status === "ok" ? `llm_probe_${mode}_ok` : `llm_probe_${result.status}`)}
          {result.http_status ? ` (HTTP ${result.http_status})` : ""}
        </Typography.Text>
        {mode === "models" && result.status === "ok" && <div style={{ maxHeight: 150, overflow: "auto", overflowWrap: "anywhere" }}>
          {result.models.length ? result.models.map((model) => onModel
            ? <Button type="link" key={model} onClick={() => onModel(model)}>{model}</Button>
            : <div key={model}>{model}</div>) : t("llm_probe_empty")}
        </div>}
      </div>;
    })}
  </Space>;
}
