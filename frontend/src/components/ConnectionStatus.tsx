import { useEffect, useRef, useState } from "react";
import { Button } from "antd";
import { LinkOutlined } from "@ant-design/icons";
import { checkLlmConnection, type LlmConnectionStatus } from "@/api/client";
import { useI18n } from "@/i18n";

type Props = {
  target: "generation" | "agent";
  title: string;
  provider: string;
  model: string;
  configured: boolean;
  disabled: boolean;
  revision: unknown;
};

export default function ConnectionStatus({ target, title, provider, model, configured, disabled, revision }: Props) {
  const { t } = useI18n();
  const [status, setStatus] = useState<LlmConnectionStatus | "untested" | "testing">("untested");
  const version = useRef(0);
  useEffect(() => {
    version.current += 1;
    setStatus("untested");
    return () => { version.current += 1; };
  }, [provider, model, revision, disabled]);
  const check = async () => {
    const requestVersion = ++version.current;
    setStatus("testing");
    try {
      const result = await checkLlmConnection(target);
      if (requestVersion === version.current) setStatus(result.status);
    } catch {
      if (requestVersion === version.current) setStatus("unavailable");
    }
  };
  const visibleStatus = configured ? status : "unconfigured";
  return <section className="connection-status" aria-label={title}>
    <span className="connection-status__title">{title}</span>
    <strong>{provider || t("ai_settings_not_configured")} · {model || "—"}</strong>
    <div className="connection-status__bottom">
      <span className="connection-status__result" data-status={visibleStatus} role="status">{t(`workspace_connection_${visibleStatus}`)}</span>
      <Button icon={<LinkOutlined />} onClick={() => void check()} loading={status === "testing"} disabled={!configured || disabled}>
        {t(status === "untested" || status === "testing" ? "workspace_check" : "workspace_recheck")}
      </Button>
    </div>
  </section>;
}
