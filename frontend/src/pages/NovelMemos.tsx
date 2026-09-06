import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Alert, Button, Dropdown, Input, Modal, App as AntApp } from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined, MoreOutlined, FileTextOutlined } from "@ant-design/icons";
import { apiErrorMessage, deleteMemo, fetchMemos } from "@/api/client";
import type { Memo } from "@/types";
import { useI18n } from "@/i18n";
import { CollectionEmpty, ManagementLoading, ManagementPage } from "@/components/novel/ManagementLayout";
import { relativeEditTime } from "@/utils/relativeTime";

export default function NovelMemos() {
  const { t, language } = useI18n();
  const { message: messageApi } = AntApp.useApp();
  const { novelId } = useParams();
  const id = Number(novelId);
  const [items, setItems] = useState<Memo[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [query, setQuery] = useState("");
  const [modal, modalContextHolder] = Modal.useModal();
  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      setItems(await fetchMemos(id));
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  function showDeleteConfirm(memo: Memo) {
    const title = (memo.title || "").trim();
    const preview = title || memo.body?.slice(0, 30) || t("memos_no_title");
    modal.confirm({
      title: t("memos_delete_memo_title"),
      content: t("memos_delete_memo_confirm").replace("{preview}", preview),
      okText: t("memos_delete"),
      okType: "danger",
      cancelText: t("common_cancel"),
      async onOk() {
        try {
          await deleteMemo(id, memo.id);
          setItems((prev) => prev.filter((x) => x.id !== memo.id));
          messageApi.success(t("memos_deleted"));
        } catch (e) {
          setErr(apiErrorMessage(e));
          messageApi.error(t("memos_delete_failed"));
        }
      },
    });
  }
  const search = query.trim().toLocaleLowerCase();
  const visible = items.filter(item => [item.title, item.body].join(" ").toLocaleLowerCase().includes(search));
  const addAction = <Link className="novel-add-link" to={`/novels/${id}/memos/new`}><PlusOutlined />{t("memos_create_memo")}</Link>;
  return (
    <ManagementPage title={t("memos_title")} description={t("management_memos_hint")}
      count={loading ? undefined : t("memos_count").replace("{count}", String(items.length))}
      action={items.length > 0 ? addAction : undefined}>
      {modalContextHolder}
      {err && <Alert title={t("operation_failed_title")} description={err} type="error" showIcon
        action={<Button size="small" onClick={() => void load()}>{t("management_retry")}</Button>} />}
      <div className="novel-collection">
        {loading ? <ManagementLoading label={t("common_loading")} /> : items.length === 0 ? (
          !err && <CollectionEmpty icon={<FileTextOutlined />} title={t("memos_no_memos")} description={t("memos_no_memos_desc")} action={addAction} />
        ) : (
          <>
            <div className="novel-collection-tools">
              <Input type="search" aria-label={t("management_memos_search")} placeholder={t("management_memos_search")}
                prefix={<SearchOutlined />} allowClear value={query} onChange={e => setQuery(e.target.value)} />
              {search && <span role="status">{t("management_search_count").replace("{count}", String(visible.length))}</span>}
            </div>
            {visible.length === 0 ? <div className="novel-search-empty" role="status">{t("management_no_results")}</div> : (
              <ul className="novel-entry-list">
                {visible.map(item => (
                  <li className="novel-entry" key={item.id}>
                    <span className="novel-entry__avatar" aria-hidden="true">{<FileTextOutlined />}</span>
                    <div className="novel-entry__body">
                      <div className="novel-entry__heading">
                        <h2><Link to={`/novels/${id}/memos/${item.id}/edit`}>{item.title.trim() || t("memos_no_title")}</Link></h2>
                        <time dateTime={item.updated_at} title={new Date(item.updated_at).toLocaleString(language)}>{relativeEditTime(item.updated_at, language)}</time>
                      </div>
                      <p className="novel-entry__preview">{item.body || t("memos_no_content")}</p>
                    </div>
                    <div className="novel-entry__actions">
                      <Link className="novel-entry__edit" to={`/novels/${id}/memos/${item.id}/edit`} aria-label={t("memos_edit") + " " + (item.title || t("memos_no_title"))}><EditOutlined />{t("memos_edit")}</Link>
                      <Dropdown trigger={["click"]} placement="bottomRight" menu={{ items: [{ key: "delete", label: t("memos_delete"), icon: <DeleteOutlined />, danger: true, onClick: () => showDeleteConfirm(item) }] }}>
                        <Button type="text" icon={<MoreOutlined />} aria-label={t("management_more_actions") + " " + (item.title || t("memos_no_title"))} />
                      </Dropdown>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </ManagementPage>
  );
}
