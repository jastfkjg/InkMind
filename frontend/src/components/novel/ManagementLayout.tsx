import type { ReactNode } from "react";
import { Button, Spin } from "antd";
import { RobotOutlined } from "@ant-design/icons";
import { useParams } from "react-router-dom";
import { useI18n } from "@/i18n";

export function ManagementPage({ title, description, count, action, children }: {
  title: string; description?: string; count?: string; action?: ReactNode; children: ReactNode;
}) {
  const { t } = useI18n();
  const { novelId } = useParams();
  return <div className="novel-management-page">
    <header className="novel-page-heading">
      <div><div className="novel-page-heading__title"><h1>{title}</h1>{count && <span className="novel-page-count">{count}</span>}</div>
        {description && <p>{description}</p>}
      </div>
      <div className="novel-page-heading__action">
        <Button type="text" icon={<RobotOutlined />} aria-label={t("smart_writer_title")}
          onClick={() => window.dispatchEvent(new CustomEvent("inkmind:assistant-open", { detail: { novelId: Number(novelId), prompt: "" } }))}>
          {t("write_ai_quick_ask")}
        </Button>
        {action}
      </div>
    </header>
    {children}
  </div>;
}

export function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="novel-form-section">
    <div className="novel-form-section__heading"><h2>{title}</h2>{description && <p>{description}</p>}</div>
    <div className="novel-form-section__fields">{children}</div>
  </section>;
}

export function ManagementLoading({ label }: { label: string }) {
  return <div className="novel-management-loading" role="status"><Spin /><span>{label}</span></div>;
}

export function CollectionEmpty({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action: ReactNode }) {
  return <div className="novel-collection-empty">
    <span className="novel-collection-empty__icon" aria-hidden="true">{icon}</span>
    <h2>{title}</h2><p>{description}</p>{action}
  </div>;
}
