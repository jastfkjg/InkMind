import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Alert, Button, Modal, App as AntApp } from "antd";
import { PlusOutlined, FileTextOutlined } from "@ant-design/icons";
import { apiErrorMessage, deleteMemo, fetchMemos } from "@/api/client";
import type { Memo } from "@/types";
import { useI18n } from "@/i18n";
import { CollectionEmpty, ManagementLoading, ManagementPage } from "@/components/novel/ManagementLayout";
import { ReferenceBrowser } from "@/components/novel/ReferenceBrowser";

export default function NovelMemos() {
  const { t } = useI18n();
  const { message: messageApi } = AntApp.useApp();
  const { novelId } = useParams();
  const id = Number(novelId);
  const [items, setItems] = useState<Memo[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
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
  const addAction = <Link className="novel-add-link" to={`/novels/${id}/memos/new`}><PlusOutlined />{t("memos_create_memo")}</Link>;
  return (
    <ManagementPage title={t("memos_title")} description={t("reference_read_hint")}
      count={loading ? undefined : t("memos_count").replace("{count}", String(items.length))}
      action={items.length > 0 ? addAction : undefined}>
      {modalContextHolder}
      {err && <Alert title={t("operation_failed_title")} description={err} type="error" showIcon
        action={<Button size="small" onClick={() => void load()}>{t("management_retry")}</Button>} />}
      <div className="novel-collection">
        {loading ? <ManagementLoading label={t("common_loading")} /> : items.length === 0 ? (
          !err && <CollectionEmpty icon={<FileTextOutlined />} title={t("memos_no_memos")} description={t("memos_no_memos_desc")} action={addAction} />
        ) : (
          <ReferenceBrowser searchLabel={t("management_memos_search")} editLabel={t("memos_edit")} deleteLabel={t("memos_delete")}
            editPath={entryId => `/novels/${id}/memos/${entryId}/edit`}
            onDelete={entryId => { const memo = items.find(item => item.id === entryId); if (memo) showDeleteConfirm(memo); }}
            entries={items.map(item => ({
              id: item.id, title: item.title.trim() || t("memos_no_title"), preview: item.body || t("memos_no_content"), updatedAt: item.updated_at,
              icon: <FileTextOutlined />,
              sections: [{ label: t("management_memo_content_heading"), content: item.body || t("memos_no_content") }],
            }))} />
        )}
      </div>
    </ManagementPage>
  );
}
