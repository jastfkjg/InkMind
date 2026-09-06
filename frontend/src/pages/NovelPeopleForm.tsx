import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Form, Input, Button, Alert, App as AntApp } from "antd";
import { SaveOutlined, ArrowLeftOutlined } from "@ant-design/icons";
import { useI18n } from "@/i18n";
import { FormSection, ManagementLoading, ManagementPage } from "@/components/novel/ManagementLayout";
import NovelAiNamingAskDock from "@/components/NovelAiNamingAskDock";
import { apiErrorMessage, createCharacter, fetchCharacters, updateCharacter } from "@/api/client";
const { TextArea } = Input;
export default function NovelPeopleForm() {
  const { t } = useI18n();
  const { message: messageApi } = AntApp.useApp();
  const { novelId, characterId } = useParams();
  const id = Number(novelId);
  const cid = characterId ? Number(characterId) : NaN;
  const isEdit = Number.isFinite(cid);
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
        const list = await fetchCharacters(id);
        const c = list.find((x) => x.id === cid);
        if (!c) {
          setErrorMsg(t("peopleform_character_not_found"));
          return;
        }
        form.setFieldsValue({
          name: c.name,
          profile: c.profile,
          notes: c.notes,
        });
      } catch (e) {
        setErrorMsg(apiErrorMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id, cid, isEdit, form, t]);
  const onFinish = async (values: {
    name: string;
    profile?: string;
    notes?: string;
  }) => {
    setErrorMsg("");
    setSaving(true);
    try {
      if (isEdit) {
        await updateCharacter(id, cid, {
          name: values.name,
          profile: values.profile || "",
          notes: values.notes || "",
        });
        messageApi.success(t("peopleform_saved"));
      } else {
        await createCharacter(id, {
          name: values.name,
          profile: values.profile || "",
          notes: values.notes || "",
        });
        messageApi.success(t("peopleform_added"));
      }
      nav(`/novels/${id}/people`);
    } catch (e) {
      setErrorMsg(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <ManagementPage title={t(isEdit ? "peopleform_edit_character" : "peopleform_new_character")}
      description={t("management_people_hint")}
      action={<Link className="novel-back-link" to={`/novels/${id}/people`}><ArrowLeftOutlined />{t("peopleform_back_to_list")}</Link>}>
      {errorMsg && <Alert title={t("peopleform_save_failed")} description={errorMsg} type="error" showIcon />}
      {loading && <ManagementLoading label={t("peopleform_loading_character")} />}
      <Form hidden={loading} form={form} name="characterForm" onFinish={onFinish} layout="vertical"
        className="novel-form-surface" initialValues={{ name: "", profile: "", notes: "" }}>
        <FormSection title={t("peopleform_basic_info")} description={t("management_character_name_hint")}>
          <Form.Item name="name" label={t("peopleform_character_name")} tooltip={t("peopleform_name_tooltip")}
            rules={[{ required: true, message: t("peopleform_name_required") }]}>
            <Input placeholder={t("peopleform_name_placeholder")} />
          </Form.Item>
          <details className="novel-ai-tools">
            <summary>{t("management_ai_inspiration")}</summary>
            <NovelAiNamingAskDock novelId={id} />
          </details>
        </FormSection>
        <FormSection title={t("peopleform_character_profile")} description={t("management_character_profile_hint")}>
          <Form.Item name="profile" label={t("peopleform_personality")} tooltip={t("peopleform_personality_tooltip")}>
            <TextArea rows={5} placeholder={t("peopleform_personality_placeholder")} />
          </Form.Item>
          <Form.Item name="notes" label={t("peopleform_other_notes")} tooltip={t("peopleform_notes_tooltip")}>
            <TextArea rows={3} placeholder={t("management_character_notes_placeholder")} />
          </Form.Item>
        </FormSection>
        <footer className="novel-form-footer">
          <p>{t("management_character_save_hint")}</p>
          <div className="novel-form-footer__actions">
            <Button onClick={() => nav(`/novels/${id}/people`)}>{t("peopleform_cancel")}</Button>
            <Button type="primary" htmlType="submit" loading={saving} icon={<SaveOutlined />}>
              {t(isEdit ? "peopleform_save_changes" : "peopleform_add_character")}
            </Button>
          </div>
        </footer>
      </Form>
    </ManagementPage>
  );
}
