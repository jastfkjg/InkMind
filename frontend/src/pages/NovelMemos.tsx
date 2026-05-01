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
import { useI18n } from "@/i18n";

const { Title, Text } = Typography;
const { confirm } = Modal;

export default function NovelMemos() {
  const { t } = useI18n();
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
    const preview = title || memo.body?.slice(0, 30) || t("memos_no_title");
    confirm({
      title: t("memos_delete_memo_title"),
      content: t("memos_delete_memo_confirm").replace("{preview}", preview),
      okText: t("memos_delete"),
      okType: "danger",
      cancelText: t("common_cancel"),
      async onOk() {
        try {
          await deleteMemo(id, memo.id);
          setItems((prev) => prev.filter((x) => x.id !== memo.id));
          message.success(t("memos_deleted"));
        } catch (e) {
          setErr(apiErrorMessage(e));
          message.error(t("memos_delete_failed"));
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
          {t("common_loading")}
        </Text>
      </div>
    );
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
            <FileTextOutlined style={{ color: "#cc785c", fontSize: "1.25rem" }} />
            <Title
              level={4}
              style={{
                margin: 0,
                fontFamily: '"Noto Serif SC", "DM Serif Display", Georgia, serif',
                color: "#141413",
              }}
            >
              {t("memos_title")}
            </Title>
            <Tag color="blue">{t("memos_count").replace("{count}", String(items.length))}</Tag>
          </Space>
        }
        extra={
          <Link to={`/novels/${id}/memos/new`}>
            <Button type="primary" icon={<PlusOutlined />} size="large">
              {t("memos_create_memo")}
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
                    {t("memos_no_memos")}
                  </Title>
                  <Text type="secondary">
                    {t("memos_no_memos_desc")}
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
                      <Tooltip title={t("memos_edit_memo")} key="edit">
                        <Link to={`/novels/${id}/memos/${m.id}/edit`}>
                          <Button
                            type="text"
                            icon={<EditOutlined />}
                            style={{ color: "#cc785c" }}
                          >
                            {t("memos_edit")}
                          </Button>
                        </Link>
                      </Tooltip>,
                      <Tooltip title={t("memos_delete_memo")} key="delete">
                        <Button
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => showDeleteConfirm(m)}
                        >
                          {t("memos_delete")}
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
                                color: "#141413",
                                fontFamily: '"Noto Serif SC", "DM Serif Display", Georgia, serif',
                              }}
                            >
                              {title}
                            </Text>
                          ) : bodyPreview ? (
                            <Text
                              strong
                              style={{
                                color: "#141413",
                              }}
                            >
                              {bodyPreview}
                            </Text>
                          ) : (
                            <Tag color="default">{t("memos_no_content")}</Tag>
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
