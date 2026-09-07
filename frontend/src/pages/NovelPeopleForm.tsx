import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Form, Input, Button, Alert, App as AntApp } from "antd";
import { SaveOutlined, ArrowLeftOutlined } from "@ant-design/icons";
import { useUnsavedForm } from "@/hooks/useUnsavedForm";
import { useI18n } from "@/i18n";
import { FormSection, ManagementLoading, ManagementPage } from "@/components/novel/ManagementLayout";
import NovelAiNamingAskDock from "@/components/NovelAiNamingAskDock";
import { apiErrorMessage, createCharacter, fetchCharacters, updateCharacter } from "@/api/client";
const { TextArea } = Input;
const emptyValues = { name: "", profile: "", notes: "" };
export default function NovelPeopleForm() {
  const { t } = useI18n();
  const { message: messageApi } = AntApp.useApp();
  const { novelId, characterId } = useParams();
  const id = Number(novelId);
  const cid = characterId ? Number(characterId) : NaN;
  const isEdit = Number.isFinite(cid);
  const nav = useNavigate();
  const [params] = useSearchParams();
  const returnPath = `/novels/${id}/people${params.size ? `?${params}` : ""}`;
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
        const payload = { name: values.name, profile: values.profile || "", notes: values.notes || "" };
        if (isEdit) await updateCharacter(id, cid, payload);
        else await createCharacter(id, payload);
        messageApi.success(t(isEdit ? "peopleform_saved" : "peopleform_added"));
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
    void fetchCharacters(id).then(list => {
      if (!active) return;
      const character = list.find(item => item.id === cid);
      if (!character) { setNotFound(true); return; }
      initialize({ name: character.name, profile: character.profile || "", notes: character.notes || "" });
      setReady(true);
    }).catch(error => { if (active) setErrorMsg(apiErrorMessage(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, cid, isEdit, initialize]);
  async function onFinish() { await saveAndContinue(() => nav(returnPath)); }
  return (
    <ManagementPage title={t(isEdit ? "peopleform_edit_character" : "peopleform_new_character")}
      description={t("management_people_hint")}
      action={<Link className="novel-back-link" to={returnPath}><ArrowLeftOutlined />{t("peopleform_back_to_list")}</Link>}>
      {leaveDialog}
      {notFound && <Alert type="error" showIcon title={t("peopleform_character_not_found")} />}
      {errorMsg && <Alert title={t("peopleform_save_failed")} description={errorMsg} type="error" showIcon />}
      {loading && <ManagementLoading label={t("peopleform_loading_character")} />}
      <Form hidden={loading} form={form} name="characterForm" onFinish={onFinish} onValuesChange={refreshDirty} disabled={saving || !ready} layout="vertical"
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
          <p role="status" className={dirty ? "novel-form-status is-dirty" : "novel-form-status"}>{t(saving ? "form_saving" : dirty ? "form_unsaved" : isEdit ? "form_saved" : "form_new_draft")}</p>
          <div className="novel-form-footer__actions">
            <Button onClick={() => nav(returnPath)}>{t("peopleform_cancel")}</Button>
            <Button type="primary" htmlType="submit" loading={saving} icon={<SaveOutlined />}>
              {t(isEdit ? "peopleform_save_changes" : "peopleform_add_character")}
            </Button>
          </div>
        </footer>
      </Form>
    </ManagementPage>
  );
}
