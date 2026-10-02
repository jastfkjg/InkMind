import { useEffect, useState } from "react";
import { Button } from "antd";
import { RobotOutlined } from "@ant-design/icons";
import { useParams } from "react-router-dom";
import { useI18n } from "@/i18n";

export default function AssistantEntry() {
  const { novelId } = useParams();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const sync = (event: Event) => setOpen(Boolean((event as CustomEvent<{ open: boolean }>).detail?.open));
    window.addEventListener("inkmind:assistant-visibility", sync);
    return () => window.removeEventListener("inkmind:assistant-visibility", sync);
  }, []);
  return <Button type="text" className="app-assistant-entry" icon={<RobotOutlined />} aria-label={t("smart_writer_title")} aria-expanded={open}
    onClick={() => window.dispatchEvent(open ? new Event("inkmind:assistant-minimize") : new CustomEvent("inkmind:assistant-open", { detail: { novelId: novelId ? Number(novelId) : undefined, prompt: "" } }))}>
    {t("write_ai_quick_ask")}
  </Button>;
}
