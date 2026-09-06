import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Alert, Button, Dropdown, Input, Modal, App as AntApp } from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined, MoreOutlined, TeamOutlined } from "@ant-design/icons";
import { apiErrorMessage, deleteCharacter, fetchCharacters } from "@/api/client";
import type { Character } from "@/types";
import { useI18n } from "@/i18n";
import { CollectionEmpty, ManagementLoading, ManagementPage } from "@/components/novel/ManagementLayout";
import { relativeEditTime } from "@/utils/relativeTime";

export default function NovelPeople() {
  const { t, language } = useI18n();
  const { message: messageApi } = AntApp.useApp();
  const { novelId } = useParams();
  const id = Number(novelId);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [query, setQuery] = useState("");
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
  const search = query.trim().toLocaleLowerCase();
  const visible = characters.filter(item => [item.name, item.profile, item.notes].join(" ").toLocaleLowerCase().includes(search));
  const addAction = <Link className="novel-add-link" to={`/novels/${id}/people/new`}><PlusOutlined />{t("people_create_character")}</Link>;
  return (
    <ManagementPage title={t("people_title")} description={t("management_people_hint")}
      count={loading ? undefined : t("people_character_count").replace("{count}", String(characters.length))}
      action={characters.length > 0 ? addAction : undefined}>
      {modalContextHolder}
      {err && <Alert title={t("operation_failed_title")} description={err} type="error" showIcon
        action={<Button size="small" onClick={() => void load()}>{t("management_retry")}</Button>} />}
      <div className="novel-collection">
        {loading ? <ManagementLoading label={t("common_loading")} /> : characters.length === 0 ? (
          !err && <CollectionEmpty icon={<TeamOutlined />} title={t("people_no_characters")} description={t("people_no_characters_desc")} action={addAction} />
        ) : (
          <>
            <div className="novel-collection-tools">
              <Input type="search" aria-label={t("management_people_search")} placeholder={t("management_people_search")}
                prefix={<SearchOutlined />} allowClear value={query} onChange={e => setQuery(e.target.value)} />
              {search && <span role="status">{t("management_search_count").replace("{count}", String(visible.length))}</span>}
            </div>
            {visible.length === 0 ? <div className="novel-search-empty" role="status">{t("management_no_results")}</div> : (
              <ul className="novel-entry-list">
                {visible.map(item => (
                  <li className="novel-entry" key={item.id}>
                    <span className="novel-entry__avatar" aria-hidden="true">{Array.from(item.name)[0] || <TeamOutlined />}</span>
                    <div className="novel-entry__body">
                      <div className="novel-entry__heading">
                        <h2><Link to={`/novels/${id}/people/${item.id}/edit`}>{item.name}</Link></h2>
                        <time dateTime={item.updated_at} title={new Date(item.updated_at).toLocaleString(language)}>{relativeEditTime(item.updated_at, language)}</time>
                      </div>
                      <p className="novel-entry__preview">{item.profile || t("people_no_settings")}</p>
                      {item.notes && <p className="novel-entry__notes">{t("peopleform_other_notes")}：{item.notes}</p>}
                    </div>
                    <div className="novel-entry__actions">
                      <Link className="novel-entry__edit" to={`/novels/${id}/people/${item.id}/edit`} aria-label={t("people_edit") + " " + (item.name)}><EditOutlined />{t("people_edit")}</Link>
                      <Dropdown trigger={["click"]} placement="bottomRight" menu={{ items: [{ key: "delete", label: t("people_delete"), icon: <DeleteOutlined />, danger: true, onClick: () => showDeleteConfirm(item) }] }}>
                        <Button type="text" icon={<MoreOutlined />} aria-label={t("management_more_actions") + " " + (item.name)} />
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
