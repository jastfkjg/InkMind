import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Alert, Button, Modal, App as AntApp } from "antd";
import { PlusOutlined, TeamOutlined } from "@ant-design/icons";
import { apiErrorMessage, deleteCharacter, fetchCharacters } from "@/api/client";
import type { Character } from "@/types";
import { useI18n } from "@/i18n";
import { CollectionEmpty, ManagementLoading, ManagementPage } from "@/components/novel/ManagementLayout";
import { ReferenceBrowser } from "@/components/novel/ReferenceBrowser";

export default function NovelPeople() {
  const { t } = useI18n();
  const { message: messageApi } = AntApp.useApp();
  const { novelId } = useParams();
  const id = Number(novelId);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [modal, modalContextHolder] = Modal.useModal();
  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      setCharacters(await fetchCharacters(id));
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  function showDeleteConfirm(char: Character) {
    modal.confirm({
      title: t("people_delete_character_title"),
      content: t("people_delete_character_confirm").replace("{name}", char.name),
      okText: t("people_delete"),
      okType: "danger",
      cancelText: t("common_cancel"),
      async onOk() {
        try {
          await deleteCharacter(id, char.id);
          setCharacters((prev) => prev.filter((c) => c.id !== char.id));
          messageApi.success(t("people_character_deleted").replace("{name}", char.name));
        } catch (e) {
          setErr(apiErrorMessage(e));
          messageApi.error(t("people_delete_failed"));
        }
      },
    });
  }
  const addAction = <Link className="novel-add-link" to={`/novels/${id}/people/new`}><PlusOutlined />{t("people_create_character")}</Link>;
  return (
    <ManagementPage title={t("people_title")} description={t("reference_read_hint")}
      count={loading ? undefined : t("people_character_count").replace("{count}", String(characters.length))}
      action={characters.length > 0 ? addAction : undefined}>
      {modalContextHolder}
      {err && <Alert title={t("operation_failed_title")} description={err} type="error" showIcon
        action={<Button size="small" onClick={() => void load()}>{t("management_retry")}</Button>} />}
      <div className="novel-collection">
        {loading ? <ManagementLoading label={t("common_loading")} /> : characters.length === 0 ? (
          !err && <CollectionEmpty icon={<TeamOutlined />} title={t("people_no_characters")} description={t("people_no_characters_desc")} action={addAction} />
        ) : (
          <ReferenceBrowser searchLabel={t("management_people_search")} editLabel={t("people_edit")} deleteLabel={t("people_delete")}
            editPath={entryId => `/novels/${id}/people/${entryId}/edit`}
            onDelete={entryId => { const character = characters.find(item => item.id === entryId); if (character) showDeleteConfirm(character); }}
            entries={characters.map(item => ({
              id: item.id, title: item.name, preview: item.profile || item.notes || t("people_no_settings"), updatedAt: item.updated_at,
              icon: Array.from(item.name)[0] || <TeamOutlined />,
              sections: [
                { label: t("peopleform_personality"), content: item.profile || t("people_no_settings") },
                ...(item.notes ? [{ label: t("peopleform_other_notes"), content: item.notes }] : []),
              ],
            }))} />
        )}
      </div>
    </ManagementPage>
  );
}
