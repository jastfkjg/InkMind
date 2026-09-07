import { useEffect, useRef, type ReactNode } from "react";
import { Button, Dropdown, Input } from "antd";
import { DeleteOutlined, EditOutlined, MoreOutlined, SearchOutlined } from "@ant-design/icons";
import { Link, useSearchParams } from "react-router-dom";
import { useI18n } from "@/i18n";
import { relativeEditTime } from "@/utils/relativeTime";

export type ReferenceEntry = {
  id: number; title: string; preview: string; updatedAt: string; icon: ReactNode;
  sections: { label: string; content: string }[];
};

export function ReferenceBrowser({ entries, searchLabel, editLabel, deleteLabel, editPath, onDelete }: {
  entries: ReferenceEntry[]; searchLabel: string; editLabel: string; deleteLabel: string;
  editPath: (id: number) => string; onDelete: (id: number) => void;
}) {
  const { t, language } = useI18n();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") || "";
  const search = query.trim().toLocaleLowerCase();
  const visible = entries.filter(entry => [entry.title, ...entry.sections.map(section => section.content)].join(" ").toLocaleLowerCase().includes(search));
  const selected = visible.find(entry => String(entry.id) === params.get("selected")) || visible[0];
  const detail = useRef<HTMLElement>(null);
  useEffect(() => { if (detail.current) detail.current.scrollTop = 0; }, [selected?.id]);
  function select(id: number) {
    setParams(previous => { const next = new URLSearchParams(previous); next.set("selected", String(id)); return next; }, { replace: true });
  }
  const returnParams = new URLSearchParams(params);
  if (selected) returnParams.set("selected", String(selected.id));
  return <div className="novel-reference-browser">
    <aside className="novel-reference-index" aria-label={searchLabel}>
      <div className="novel-reference-search">
        <Input type="search" aria-label={searchLabel} placeholder={searchLabel} prefix={<SearchOutlined />} allowClear value={query}
          onChange={event => setParams(previous => {
            const next = new URLSearchParams(previous);
            if (event.target.value) next.set("q", event.target.value); else next.delete("q");
            return next;
          }, { replace: true })} />
        <span role="status">{t("management_search_count").replace("{count}", String(visible.length))}</span>
      </div>
      <ul className="novel-reference-list">
        {visible.map(entry => <li key={entry.id}>
          <button type="button" className={`novel-reference-item${selected?.id === entry.id ? " is-selected" : ""}`}
            onClick={() => select(entry.id)} aria-current={selected?.id === entry.id ? "true" : undefined} aria-controls="novel-reference-detail">
            <span className="novel-entry__avatar" aria-hidden="true">{entry.icon}</span>
            <span className="novel-reference-item__body"><strong>{entry.title}</strong><span>{entry.preview}</span>
              <time dateTime={entry.updatedAt}>{relativeEditTime(entry.updatedAt, language)}</time>
            </span>
          </button>
        </li>)}
      </ul>
    </aside>
    <article ref={detail} className="novel-reference-detail" id="novel-reference-detail" aria-label={selected?.title || t("reference_details")} tabIndex={0}>
      {selected ? <>
        <header className="novel-reference-detail__heading">
          <div><h2>{selected.title}</h2><time dateTime={selected.updatedAt}>{t("reference_updated").replace("{time}", new Date(selected.updatedAt).toLocaleString(language))}</time></div>
          <div className="novel-entry__actions">
            <Link className="novel-entry__edit" to={`${editPath(selected.id)}?${returnParams}`}><EditOutlined />{editLabel}</Link>
            <Dropdown trigger={["click"]} placement="bottomRight" menu={{ items: [{ key: "delete", label: deleteLabel, icon: <DeleteOutlined />, danger: true, onClick: () => onDelete(selected.id) }] }}>
              <Button type="text" icon={<MoreOutlined />} aria-label={`${t("management_more_actions")} ${selected.title}`} />
            </Dropdown>
          </div>
        </header>
        <div className="novel-reference-detail__content">
          {selected.sections.map(section => <section key={section.label}><h3>{section.label}</h3><p>{section.content}</p></section>)}
        </div>
      </> : <div className="novel-search-empty" role="status">{t("management_no_results")}</div>}
    </article>
  </div>;
}
