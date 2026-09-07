import { probeSavedLlm } from "@/api/client";
import { useI18n } from "@/i18n";
import LlmProbeControls from "./LlmProbeControls";

type Props = {
  target: "generation" | "agent"; title: string; provider: string; model: string;
  configured: boolean; disabled: boolean; revision: unknown;
};
export default function ConnectionStatus({ target, title, provider, model, configured, disabled, revision }: Props) {
  const { t } = useI18n();
  return <section className="connection-status" aria-label={title}>
    <span className="connection-status__title">{title}</span>
    <strong>{provider || t("ai_settings_not_configured")} · {model || "—"}</strong>
    {!configured && <span>{t("workspace_connection_unconfigured")}</span>}
    <LlmProbeControls disabled={!configured || disabled} revision={JSON.stringify([target, provider, model, revision])}
      run={(mode) => probeSavedLlm(target, mode)} />
  </section>;
}
