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

const { Title, Text } = Typography;
const { confirm } = Modal;

export default function NovelPeople() {
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
      title: "删除人物",
      content: `确定要删除人物「${char.name}」吗？此操作不可恢复。`,
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      async onOk() {
        try {
          await deleteCharacter(id, char.id);
          setCharacters((prev) => prev.filter((c) => c.id !== char.id));
          message.success(`人物「${char.name}」已删除`);
        } catch (e) {
          setErr(apiErrorMessage(e));
          message.error("删除失败");
        }
      },
    });
  }

  return (
    <div style={{ padding: "0.5rem" }}>
      {err && (
        <Alert
          message="操作失败"
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
          background: "#fffcf7",
        }}
        title={
          <Space>
            <TeamOutlined style={{ color: "#7c2d12", fontSize: "1.25rem" }} />
            <Title
              level={4}
              style={{
                margin: 0,
                fontFamily: '"Noto Serif SC", "DM Serif Display", Georgia, serif',
                color: "#1c1917",
              }}
            >
              人物管理
            </Title>
            <Tag color="blue">{characters.length} 位</Tag>
          </Space>
        }
        extra={
          <Link to={`/novels/${id}/people/new`}>
            <Button type="primary" icon={<PlusOutlined />} size="large">
              添加人物
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
                    还没有人物
                  </Title>
                  <Text type="secondary">
                    点击「添加人物」开始创建你的角色
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
                    <Tooltip title="编辑人物" key="edit">
                      <Link to={`/novels/${id}/people/${char.id}/edit`}>
                        <Button
                          type="text"
                          icon={<EditOutlined />}
                          style={{ color: "#7c2d12" }}
                        >
                          编辑
                        </Button>
                      </Link>
                    </Tooltip>,
                    <Tooltip title="删除人物" key="delete">
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => showDeleteConfirm(char)}
                      >
                        删除
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
                          background: "linear-gradient(135deg, #7c2d12 0%, #9a3412 100%)",
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
                          color: "#1c1917",
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
                          <Tag color="default">未填写设定</Tag>
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
