import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Form, Input, Button, Alert, App as AntApp } from "antd";
import { SaveOutlined, ArrowLeftOutlined } from "@ant-design/icons";
import { useUnsavedForm } from "@/hooks/useUnsavedForm";
import { useI18n } from "@/i18n";
import { FormSection, ManagementLoading, ManagementPage } from "@/components/novel/ManagementLayout";
import { apiErrorMessage, createMemo, fetchMemos, updateMemo } from "@/api/client";
const { TextArea } = Input;
const emptyValues = { title: "", body: "" };
export default function NovelMemoForm() {
  const { t } = useI18n();
  const { message: messageApi } = AntApp.useApp();
  const { novelId, memoId } = useParams();
  const id = Number(novelId);
  const mid = memoId ? Number(memoId) : NaN;
  const isEdit = Number.isFinite(mid);
  const nav = useNavigate();
  const [params] = useSearchParams();
  const returnPath = `/novels/${id}/memos${params.size ? `?${params}` : ""}`;
  const [form] = Form.useForm<typeof emptyValues>();
  const [loading, setLoading] = useState(isEdit);
  const [ready, setReady] = useState(!isEdit);
  const [errorMsg, setErrorMsg] = useState("");
  const [notFound, setNotFound] = useState(false);
  const { dirty, saving, initialize, refreshDirty, saveAndContinue, leaveDialog } = useUnsavedForm({
    form, emptyValues,
    async onSave(values) {
      setErrorMsg("");
      try {
        const payload = { title: values.title || "", body: values.body };
        if (isEdit) await updateMemo(id, mid, payload);
        else await createMemo(id, payload);
        messageApi.success(t(isEdit ? "memoform_updated" : "memoform_created"));
      } catch (error) { setErrorMsg(apiErrorMessage(error)); throw error; }
    },
  });
  useEffect(() => {
    let active = true;
    setErrorMsg("");
    setNotFound(false);
    setReady(!isEdit);
    setLoading(isEdit);
    if (!isEdit) { initialize(emptyValues); return; }
    void fetchMemos(id).then(list => {
      if (!active) return;
      const memo = list.find(item => item.id === mid);
      if (!memo) { setNotFound(true); return; }
      initialize({ title: memo.title || "", body: memo.body || "" });
      setReady(true);
    }).catch(error => { if (active) setErrorMsg(apiErrorMessage(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, mid, isEdit, initialize]);
  async function onFinish() { await saveAndContinue(() => nav(returnPath)); }
  return (
    <ManagementPage title={t(isEdit ? "memoform_edit_memo" : "memoform_new_memo")}
      description={t("management_memos_hint")}
      action={<Link className="novel-back-link" to={returnPath}><ArrowLeftOutlined />{t("memoform_back_to_list")}</Link>}>
      {leaveDialog}
      {notFound && <Alert type="error" showIcon title={t("memoform_memo_not_found")} />}
      {errorMsg && <Alert title={t("memoform_operation_failed")} description={errorMsg} type="error" showIcon />}
      {loading && <ManagementLoading label={t("memoform_loading_memo")} />}
      <Form hidden={loading} form={form} name="memoForm" onFinish={onFinish} onValuesChange={refreshDirty} disabled={saving || !ready} layout="vertical"
        className="novel-form-surface" initialValues={{ title: "", body: "" }}>
        <FormSection title={t("memoform_memo_info")} description={t("management_memo_title_hint")}>
          <Form.Item name="title" label={`${t("memoform_memo_title")} ${t("memoform_title_optional")}`}>
            <Input placeholder={t("memoform_title_placeholder")} />
          </Form.Item>
        </FormSection>
        <FormSection title={t("management_memo_content_heading")} description={t("management_memo_content_hint")}>
          <Form.Item name="body" label={t("memoform_memo_content")}
            rules={[{ required: true, message: t("memoform_content_required") }]}>
            <TextArea rows={10} placeholder={t("memoform_content_placeholder")} />
          </Form.Item>
        </FormSection>
        <footer className="novel-form-footer">
          <p role="status" className={dirty ? "novel-form-status is-dirty" : "novel-form-status"}>{t(saving ? "form_saving" : dirty ? "form_unsaved" : isEdit ? "form_saved" : "form_new_draft")}</p>
          <div className="novel-form-footer__actions">
            <Button onClick={() => nav(returnPath)}>{t("memoform_cancel")}</Button>
            <Button type="primary" htmlType="submit" loading={saving} icon={<SaveOutlined />}>
              {t(isEdit ? "memoform_save_changes" : "memoform_add_memo")}
            </Button>
          </div>
        </footer>
      </Form>
    </ManagementPage>
  );
}
