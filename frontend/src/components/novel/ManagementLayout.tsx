import type { ReactNode } from "react";
import { Spin } from "antd";

export function ManagementPage({ title, description, count, action, className = "", children }: {
  title: string; description?: string; count?: string; action?: ReactNode; className?: string; children: ReactNode;
}) {
  return <div className={`novel-management-page ${className}`}>
    <header className="novel-page-heading">
      <div><div className="novel-page-heading__title"><h1>{title}</h1>{count && <span className="novel-page-count">{count}</span>}</div>
        {description && <p>{description}</p>}
      </div>
      <div className="novel-page-heading__action">
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
