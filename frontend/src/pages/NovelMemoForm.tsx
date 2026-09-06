import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Form, Input, Button, Alert, App as AntApp } from "antd";
import { SaveOutlined, ArrowLeftOutlined } from "@ant-design/icons";
import { useI18n } from "@/i18n";
import { FormSection, ManagementLoading, ManagementPage } from "@/components/novel/ManagementLayout";
import { apiErrorMessage, createMemo, fetchMemos, updateMemo } from "@/api/client";
const { TextArea } = Input;
export default function NovelMemoForm() {
  const { t } = useI18n();
  const { message: messageApi } = AntApp.useApp();
  const { novelId, memoId } = useParams();
  const id = Number(novelId);
  const mid = memoId ? Number(memoId) : NaN;
  const isEdit = Number.isFinite(mid);
  const nav = useNavigate();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(isEdit);
  const [errorMsg, setErrorMsg] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      setErrorMsg("");
      try {
        const list = await fetchMemos(id);
        const m = list.find((x) => x.id === mid);
        if (!m) {
          setErrorMsg(t("memoform_memo_not_found"));
          return;
        }
        form.setFieldsValue({
          title: m.title,
          body: m.body,
        });
      } catch (e) {
        setErrorMsg(apiErrorMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id, mid, isEdit, form, t]);
  async function onFinish(values: { title: string; body: string }) {
    setErrorMsg("");
    setSaving(true);
    try {
      if (isEdit) {
        await updateMemo(id, mid, { title: values.title, body: values.body });
        messageApi.success(t("memoform_updated"));
      } else {
        await createMemo(id, { title: values.title, body: values.body });
        messageApi.success(t("memoform_created"));
      }
      nav(`/novels/${id}/memos`);
    } catch (e) {
      setErrorMsg(apiErrorMessage(e));
      messageApi.error(t("memoform_save_failed"));
    } finally {
      setSaving(false);
    }
  }
  return (
    <ManagementPage title={t(isEdit ? "memoform_edit_memo" : "memoform_new_memo")}
      description={t("management_memos_hint")}
      action={<Link className="novel-back-link" to={`/novels/${id}/memos`}><ArrowLeftOutlined />{t("memoform_back_to_list")}</Link>}>
      {errorMsg && <Alert title={t("memoform_operation_failed")} description={errorMsg} type="error" showIcon />}
      {loading && <ManagementLoading label={t("memoform_loading_memo")} />}
      <Form hidden={loading} form={form} name="memoForm" onFinish={onFinish} layout="vertical"
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
          <div className="novel-form-footer__actions">
            <Button onClick={() => nav(`/novels/${id}/memos`)}>{t("memoform_cancel")}</Button>
            <Button type="primary" htmlType="submit" loading={saving} icon={<SaveOutlined />}>
              {t(isEdit ? "memoform_save_changes" : "memoform_add_memo")}
            </Button>
          </div>
        </footer>
      </Form>
    </ManagementPage>
  );
}
