import { useEffect, useRef, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { Form, Input, Button, Alert, App as AntApp } from "antd";
import { SaveOutlined } from "@ant-design/icons";
import { apiErrorMessage, updateNovel } from "@/api/client";
import { useUnsavedForm } from "@/hooks/useUnsavedForm";
import type { Novel } from "@/types";
import { useI18n } from "@/i18n";
import { FormSection, ManagementLoading, ManagementPage } from "@/components/novel/ManagementLayout";
type Ctx = { novel: Novel | null; setNovel: React.Dispatch<React.SetStateAction<Novel | null>> };
const { TextArea } = Input;
const emptyValues = { title: "", background: "", genre: "", writingStyle: "" };
export default function NovelSettings() {
  const { t } = useI18n();
  const { message: messageApi } = AntApp.useApp();
  const { novelId } = useParams();
  const id = Number(novelId);
  const { novel, setNovel } = useOutletContext<Ctx>();
  const [form] = Form.useForm<typeof emptyValues>();
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const loadedId = useRef<number | null>(null);
  const { dirty, saving, initialize, refreshDirty, save, leaveDialog } = useUnsavedForm({
    form, emptyValues,
    async onSave(values) {
      setErrorMsg("");
      setSuccessMsg("");
      try {
        const n = await updateNovel(id, {
          title: values.title,
          background: values.background || "",
          genre: values.genre || "",
          writing_style: values.writingStyle || "",
        });
        setNovel(n);
        messageApi.success(t("settings_success"));
        setSuccessMsg(t("settings_success"));
      } catch (error) {
        setErrorMsg(apiErrorMessage(error));
        throw error;
      }
    },
  });
  useEffect(() => {
    if (!novel || loadedId.current === novel.id) return;
    loadedId.current = novel.id;
    initialize({ title: novel.title, background: novel.background || "", genre: novel.genre || "", writingStyle: novel.writing_style || "" });
  }, [novel, initialize]);
  return (
    <ManagementPage title={t("settings_title")} description={t("manage_novel_basic_info")}>
      {leaveDialog}
      {successMsg && <Alert title={successMsg} type="success" showIcon role="status" />}
      {errorMsg && <Alert title={t("save_error_title")} description={errorMsg} type="error" showIcon />}
      {!novel && <ManagementLoading label={t("loading_novel_info")} />}
      <Form hidden={!novel} form={form} name="novelSettings" onFinish={() => void save()} onValuesChange={() => { refreshDirty(); setSuccessMsg(""); }} disabled={saving} layout="vertical"
        className="novel-form-surface" initialValues={{ title: "", background: "", genre: "", writingStyle: "" }}>
        <FormSection title={t("settings_general")} description={t("management_basic_hint")}>
          <div className="novel-form-grid">
            <Form.Item name="title" label={t("novel_title")} rules={[{ required: true, message: t("please_enter_novel_title") }]}>
              <Input placeholder={t("enter_novel_title_placeholder")} />
            </Form.Item>
            <Form.Item name="genre" label={t("novel_genre")} tooltip={t("genre_tooltip")}>
              <Input placeholder={t("genre_placeholder")} />
            </Form.Item>
          </div>
        </FormSection>
        <FormSection title={t("writing_style_and_background")} description={t("management_world_hint")}>
          <Form.Item name="writingStyle" label={t("writing_style")} tooltip={t("writing_style_tooltip")}>
            <TextArea rows={3} placeholder={t("writing_style_placeholder")} />
          </Form.Item>
          <Form.Item name="background" label={t("background_setting")} tooltip={t("background_tooltip")}>
            <TextArea rows={5} placeholder={t("background_placeholder")} />
          </Form.Item>
        </FormSection>
        <footer className="novel-form-footer">
          <p role="status" className={dirty ? "novel-form-status is-dirty" : "novel-form-status"}>{t(saving ? "form_saving" : dirty ? "form_unsaved" : "form_saved")}</p>
          <div className="novel-form-footer__actions">
            <Button type="primary" htmlType="submit" loading={saving} icon={<SaveOutlined />}>{t("settings_save")}</Button>
          </div>
        </footer>
      </Form>
    </ManagementPage>
  );
}
