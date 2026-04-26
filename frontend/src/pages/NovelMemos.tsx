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
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import { apiErrorMessage, deleteMemo, fetchMemos } from "@/api/client";
import type { Memo } from "@/types";

const { Title, Text } = Typography;
const { confirm } = Modal;

export default function NovelMemos() {
  const { novelId } = useParams();
  const id = Number(novelId);
  const [items, setItems] = useState<Memo[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  async function load() {
    const list = await fetchMemos(id);
    setItems(list);
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

  function showDeleteConfirm(memo: Memo) {
    const title = (memo.title || "").trim();
    const preview = title || memo.body?.slice(0, 30) || "无标题";
    confirm({
      title: "删除备忘",
      content: `确定要删除备忘「${preview}」吗？此操作不可恢复。`,
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      async onOk() {
        try {
          await deleteMemo(id, memo.id);
          setItems((prev) => prev.filter((x) => x.id !== memo.id));
          message.success("备忘已删除");
        } catch (e) {
          setErr(apiErrorMessage(e));
          message.error("删除失败");
        }
      },
    });
  }

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          padding: "4rem 2rem",
        }}
      >
        <Spin size="large" />
        <Text type="secondary" style={{ marginLeft: "1rem", fontSize: "1rem" }}>
          加载中…
        </Text>
      </div>
    );
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
            <FileTextOutlined style={{ color: "#7c2d12", fontSize: "1.25rem" }} />
            <Title
              level={4}
              style={{
                margin: 0,
                fontFamily: '"Noto Serif SC", "DM Serif Display", Georgia, serif',
                color: "#1c1917",
              }}
            >
              备忘
            </Title>
            <Tag color="blue">{items.length} 条</Tag>
          </Space>
        }
        extra={
          <Link to={`/novels/${id}/memos/new`}>
            <Button type="primary" icon={<PlusOutlined />} size="large">
              添加备忘
            </Button>
          </Link>
        }
      >
        <Spin spinning={loading}>
          {items.length === 0 ? (
            <Empty
              description={
                <div>
                  <Title level={5} style={{ marginBottom: "0.5rem" }}>
                    暂无备忘
                  </Title>
                  <Text type="secondary">
                    点击「添加备忘」开始记录你的灵感和想法
                  </Text>
                </div>
              }
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              style={{ padding: "3rem 0" }}
            />
          ) : (
            <List
              dataSource={items}
              renderItem={(m) => {
                const title = (m.title || "").trim();
                const rawBody = (m.body || "").trim();
                const bodyPreview = rawBody
                  ? `${rawBody.slice(0, 120)}${rawBody.length > 120 ? "…" : ""}`
                  : "";

                return (
                  <List.Item
                    key={m.id}
                    actions={[
                      <Tooltip title="编辑备忘" key="edit">
                        <Link to={`/novels/${id}/memos/${m.id}/edit`}>
                          <Button
                            type="text"
                            icon={<EditOutlined />}
                            style={{ color: "#7c2d12" }}
                          >
                            编辑
                          </Button>
                        </Link>
                      </Tooltip>,
                      <Tooltip title="删除备忘" key="delete">
                        <Button
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => showDeleteConfirm(m)}
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
                      title={
                        <div>
                          {title ? (
                            <Text
                              strong
                              style={{
                                fontSize: "1.05rem",
                                color: "#1c1917",
                                fontFamily: '"Noto Serif SC", "DM Serif Display", Georgia, serif',
                              }}
                            >
                              {title}
                            </Text>
                          ) : bodyPreview ? (
                            <Text
                              strong
                              style={{
                                color: "#1c1917",
                              }}
                            >
                              {bodyPreview}
                            </Text>
                          ) : (
                            <Tag color="default">无正文</Tag>
                          )}
                        </div>
                      }
                      description={
                        title && bodyPreview ? (
                          <Text
                            type="secondary"
                            style={{ fontSize: "0.9rem", marginTop: "0.25rem" }}
                          >
                            {bodyPreview}
                          </Text>
                        ) : null
                      }
                    />
                  </List.Item>
                );
              }}
            />
          )}
        </Spin>
      </Card>
    </div>
  );
}
