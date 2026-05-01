import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Card,
  List,
  Button,
  Typography,
  Empty,
  Spin,
  Alert,
  Tag,
  Space,
  Tooltip,
  Modal,
  message,
  Avatar,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  UserOutlined,
  TeamOutlined,
  InfoCircleOutlined,
} from "@ant-design/icons";
import { apiErrorMessage, deleteCharacter, fetchCharacters } from "@/api/client";
import type { Character } from "@/types";
import { useI18n } from "@/i18n";

const { Title, Text } = Typography;
const { confirm } = Modal;

export default function NovelPeople() {
  const { t } = useI18n();
  const { novelId } = useParams();
  const id = Number(novelId);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  async function load() {
    try {
      const chars = await fetchCharacters(id);
      setCharacters(chars);
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        await load();
      } catch (e) {
        setErr(apiErrorMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  function showDeleteConfirm(char: Character) {
    confirm({
      title: t("people_delete_character_title"),
      content: t("people_delete_character_confirm").replace("{name}", char.name),
      okText: t("people_delete"),
      okType: "danger",
      cancelText: t("common_cancel"),
      async onOk() {
        try {
          await deleteCharacter(id, char.id);
          setCharacters((prev) => prev.filter((c) => c.id !== char.id));
          message.success(t("people_character_deleted").replace("{name}", char.name));
        } catch (e) {
          setErr(apiErrorMessage(e));
          message.error(t("people_delete_failed"));
        }
      },
    });
  }

  return (
    <div style={{ padding: "0.5rem" }}>
      {err && (
        <Alert
          message={t("operation_failed_title")}
          description={err}
          type="error"
          showIcon
          style={{ marginBottom: "1rem" }}
        />
      )}

      <Card
        style={{
          borderRadius: 16,
          border: "none",
          boxShadow: "0 4px 6px rgba(28, 25, 23, 0.06)",
          background: "#faf9f5",
        }}
        title={
          <Space>
            <TeamOutlined style={{ color: "#cc785c", fontSize: "1.25rem" }} />
            <Title
              level={4}
              style={{
                margin: 0,
                fontFamily: '"Noto Serif SC", "DM Serif Display", Georgia, serif',
                color: "#141413",
              }}
            >
              {t("people_title")}
            </Title>
            <Tag color="blue">{t("people_character_count").replace("{count}", String(characters.length))}</Tag>
          </Space>
        }
        extra={
          <Link to={`/novels/${id}/people/new`}>
            <Button type="primary" icon={<PlusOutlined />} size="large">
              {t("people_create_character")}
            </Button>
          </Link>
        }
      >
        <Spin spinning={loading}>
          {characters.length === 0 ? (
            <Empty
              description={
                <div>
                  <Title level={5} style={{ marginBottom: "0.5rem" }}>
                    {t("people_no_characters")}
                  </Title>
                  <Text type="secondary">
                    {t("people_no_characters_desc")}
                  </Text>
                </div>
              }
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              style={{ padding: "3rem 0" }}
            />
          ) : (
            <List
              dataSource={characters}
              renderItem={(char) => (
                <List.Item
                  key={char.id}
                  actions={[
                    <Tooltip title={t("people_edit_character")} key="edit">
                      <Link to={`/novels/${id}/people/${char.id}/edit`}>
                        <Button
                          type="text"
                          icon={<EditOutlined />}
                          style={{ color: "#cc785c" }}
                        >
                          {t("people_edit")}
                        </Button>
                      </Link>
                    </Tooltip>,
                    <Tooltip title={t("people_delete_character")} key="delete">
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => showDeleteConfirm(char)}
                      >
                        {t("people_delete")}
                      </Button>
                    </Tooltip>,
                  ]}
                  style={{
                    padding: "1rem 0",
                    borderBottom: "1px solid #e7e0d5",
                  }}
                >
                  <List.Item.Meta
                    avatar={
                      <Avatar
                        size={48}
                        icon={<UserOutlined />}
                        style={{
                          background: "linear-gradient(135deg, #cc785c 0%, #a9583e 100%)",
                          fontSize: "1.25rem",
                        }}
                      >
                        {char.name?.charAt(0)}
                      </Avatar>
                    }
                    title={
                      <Text
                        strong
                        style={{
                          fontSize: "1.05rem",
                          color: "#141413",
                          fontFamily: '"Noto Serif SC", "DM Serif Display", Georgia, serif',
                        }}
                      >
                        {char.name}
                      </Text>
                    }
                    description={
                      <div>
                        {char.profile && (
                          <Text type="secondary" style={{ fontSize: "0.9rem" }}>
                            <InfoCircleOutlined
                              style={{ marginRight: "0.25rem", color: "#78716c" }}
                            />
                            {char.profile.slice(0, 80)}
                            {char.profile.length > 80 ? "…" : ""}
                          </Text>
                        )}
                        {char.notes && (
                          <div style={{ marginTop: "0.25rem" }}>
                            <Text type="secondary" style={{ fontSize: "0.85rem" }}>
                              ({char.notes.slice(0, 60)}
                              {char.notes.length > 60 ? "…" : ""})
                            </Text>
                          </div>
                        )}
                        {!char.profile && !char.notes && (
                          <Tag color="default">{t("people_no_settings")}</Tag>
                        )}
                      </div>
                    }
                  />
                </List.Item>
              )}
            />
          )}
        </Spin>
      </Card>
    </div>
  );
}
