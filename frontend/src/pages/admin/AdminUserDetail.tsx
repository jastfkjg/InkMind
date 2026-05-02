import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Card,
  Typography,
  Button,
  Space,
  Tag,
  Spin,
  Modal,
  Input,
  InputNumber,
  Form,
  Table,
  Statistic,
  Row,
  Col,
  Divider,
  message,
  Popconfirm,
  Tabs,
  Progress,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  ArrowLeftOutlined,
  EditOutlined,
  ReloadOutlined,
  SafetyOutlined,
  CheckOutlined,
  CloseOutlined,
  BookOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  apiErrorMessage,
  fetchAdminUser,
  updateUserQuota,
  resetUserQuotaUsage,
  fetchUserNovels,
  fetchUserUsage,
  fetchQuotaChanges,
} from "@/api/client";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/i18n";
import type { AdminUser, UserNovel, TokenQuotaChange, UserUsageDetail } from "@/types";

const { Title, Text, Paragraph } = Typography;

export default function AdminUserDetail() {
  const { userId } = useParams<{ userId: string }>();
  const { isDark } = useTheme();
  const { t, isZh } = useI18n();
  const nav = useNavigate();
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<AdminUser | null>(null);
  const [novels, setNovels] = useState<UserNovel[]>([]);
  const [novelsTotal, setNovelsTotal] = useState(0);
  const [usage, setUsage] = useState<UserUsageDetail | null>(null);
  const [quotaChanges, setQuotaChanges] = useState<TokenQuotaChange[]>([]);
  const [quotaChangesTotal, setQuotaChangesTotal] = useState(0);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm] = Form.useForm();
  const [err, setErr] = useState("");

  const textColor = isDark ? "#e7e5e1" : "#141413";
  const secondaryTextColor = isDark ? "#a3a19b" : "#6c6a64";
  const cardBg = isDark ? "#1e1d1b" : "#faf9f5";
  const accentColor = "#cc785c";

  async function load() {
    if (!userId) return;
    setErr("");
    setLoading(true);
    try {
      const id = parseInt(userId, 10);
      const [userData, novelsData, usageData, quotaData] = await Promise.all([
        fetchAdminUser(id),
        fetchUserNovels(id, { page: 1, pageSize: 50 }),
        fetchUserUsage(id, 30),
        fetchQuotaChanges({ userId: id, page: 1, pageSize: 20 }),
      ]);
      setUser(userData as AdminUser);
      setNovels(novelsData.items as UserNovel[]);
      setNovelsTotal(novelsData.total);
      setUsage(usageData);
      setQuotaChanges(quotaData.items as TokenQuotaChange[]);
      setQuotaChangesTotal(quotaData.total);
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [userId]);

  function openEditModal() {
    if (!user) return;
    editForm.setFieldsValue({
      token_quota: user.token_quota,
      reason: "",
    });
    setEditModalOpen(true);
  }

  async function handleEditQuota(values: { token_quota: number | null; reason: string }) {
    if (!userId) return;
    try {
      const id = parseInt(userId, 10);
      await updateUserQuota(id, {
        token_quota: values.token_quota ?? null,
        reason: values.reason,
      });
      message.success(t("admin_quota_save_success"));
      setEditModalOpen(false);
      load();
    } catch (e) {
      message.error(apiErrorMessage(e));
    }
  }

  async function handleResetQuotaUsage() {
    if (!userId) return;
    try {
      const id = parseInt(userId, 10);
      await resetUserQuotaUsage(id);
      message.success(t("admin_user_reset_success"));
      load();
    } catch (e) {
      message.error(apiErrorMessage(e));
    }
  }

  function quotaDisplay(quota: number | null) {
    if (quota === null) {
      return (
        <Tag color="green">
          <CheckOutlined /> {t("quota_unlimited")}
        </Tag>
      );
    }
    if (quota === 0) {
      return (
        <Tag color="red">
          <CloseOutlined /> 0 ({t("dashboard_disabled")})
        </Tag>
      );
    }
    return <Tag color="blue">{quota.toLocaleString(isZh ? "zh-CN" : "en-US")}</Tag>;
  }

  function getQuotaStatus(quota: number | null, used: number) {
    if (quota === null) return { status: "normal", color: "#52c41a" };
    if (quota === 0) return { status: "error", color: "#ff4d4f" };
    const pct = (used / quota) * 100;
    if (pct >= 100) return { status: "error", color: "#ff4d4f" };
    if (pct >= 80) return { status: "exception", color: "#faad14" };
    return { status: "normal", color: "#52c41a" };
  }

  const novelColumns: ColumnsType<UserNovel> = [
    {
      title: t("novel_title"),
      dataIndex: "title",
      key: "title",
      render: (title: string) => (
        <Text strong style={{ color: textColor }}>
          {title || t("dashboard_untitled")}
        </Text>
      ),
    },
    {
      title: t("novel_genre"),
      dataIndex: "genre",
      key: "genre",
      width: 120,
      render: (genre: string) => genre || "-",
    },
    {
      title: t("chapters"),
      dataIndex: "chapter_count",
      key: "chapter_count",
      width: 100,
      render: (count: number) => count.toLocaleString(isZh ? "zh-CN" : "en-US"),
    },
    {
      title: t("created_at"),
      dataIndex: "created_at",
      key: "created_at",
      width: 180,
      render: (date: string) => new Date(date).toLocaleString(isZh ? "zh-CN" : "en-US"),
    },
  ];

  const quotaChangeColumns: ColumnsType<TokenQuotaChange> = [
    {
      title: t("created_at"),
      dataIndex: "created_at",
      key: "created_at",
      width: 180,
      render: (date: string) => new Date(date).toLocaleString(isZh ? "zh-CN" : "en-US"),
    },
    {
      title: t("admin_quota_old"),
      dataIndex: "old_quota",
      key: "old_quota",
      render: (q: number | null) =>
        q === null ? t("quota_unlimited") : q.toLocaleString(isZh ? "zh-CN" : "en-US"),
    },
    {
      title: t("admin_quota_new"),
      dataIndex: "new_quota",
      key: "new_quota",
      render: (q: number | null) =>
        q === null ? t("quota_unlimited") : q.toLocaleString(isZh ? "zh-CN" : "en-US"),
    },
    {
      title: t("admin_quota_reason"),
      dataIndex: "reason",
      key: "reason",
      render: (r: string | null) => r || "-",
    },
  ];

  const tabItems = [
    {
      key: "overview",
      label: (
        <Space>
          <UserOutlined /> {t("admin_user_detail_title")}
        </Space>
      ),
      children: (
        <div>
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12} md={6}>
              <Card size="small" className="ops-panel">
                <Statistic
                  title={t("admin_users_call_count")}
                  value={user?.llm_call_count || 0}
                  valueStyle={{ color: accentColor }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Card size="small" className="ops-panel">
                <Statistic
                  title={t("novel_count")}
                  value={novelsTotal}
                  valueStyle={{ color: accentColor }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Card size="small" className="ops-panel">
                <Statistic
                  title={t("usage_last_30_days")}
                  value={usage?.total_tokens || 0}
                  precision={0}
                  valueStyle={{ color: accentColor }}
                  suffix="Tokens"
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Card size="small" className="ops-panel">
                <Statistic
                  title={t("admin_users_created")}
                  value={user?.created_at ? new Date(user.created_at).toLocaleDateString(isZh ? "zh-CN" : "en-US") : "-"}
                  valueStyle={{ color: secondaryTextColor, fontSize: 14 }}
                />
              </Card>
            </Col>
          </Row>

          <Divider />

          <div>
            <Title level={5} style={{ marginBottom: 16, color: textColor }}>
              {t("quota_title")}
            </Title>
            <Card
              className="ops-panel"
              size="small"
              style={{ background: cardBg }}
              extra={
                <Space>
                  <Button icon={<EditOutlined />} onClick={openEditModal}>
                    {t("admin_user_edit_quota")}
                  </Button>
                  <Popconfirm
                    title={t("admin_user_reset_confirm")}
                    onConfirm={handleResetQuotaUsage}
                    okText={t("common_confirm")}
                    cancelText={t("common_cancel")}
                  >
                    <Button icon={<ReloadOutlined />}>
                      {t("admin_user_reset_quota_usage")}
                    </Button>
                  </Popconfirm>
                </Space>
              }
            >
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ marginBottom: 8 }}>
                    <Space>
                      <Text strong style={{ color: textColor }}>
                        {t("quota_total")}:
                      </Text>
                      {quotaDisplay(user?.token_quota ?? null)}
                    </Space>
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <Space>
                      <Text strong style={{ color: textColor }}>
                        {t("quota_used")}:
                      </Text>
                      <Tag
                        color={
                          getQuotaStatus(user?.token_quota ?? null, user?.token_quota_used ?? 0).color
                        }
                      >
                        {(user?.token_quota_used ?? 0).toLocaleString(isZh ? "zh-CN" : "en-US")}
                      </Tag>
                    </Space>
                  </div>
                  {user?.token_quota !== null && (
                    <Progress
                      percent={Math.min(
                        (user?.token_quota_used ?? 0) / (user?.token_quota || 1) * 100,
                        100
                      )}
                      status={
                        getQuotaStatus(user?.token_quota ?? null, user?.token_quota_used ?? 0).status as
                          | "normal"
                          | "exception"
                          | "active"
                          | "success"
                      }
                      format={(p) => `${p?.toFixed(1) || 0}%`}
                    />
                  )}
                </div>
              </div>
            </Card>
          </div>
        </div>
      ),
    },
    {
      key: "novels",
      label: (
        <Space>
          <BookOutlined /> {t("admin_user_novels")} ({novelsTotal})
        </Space>
      ),
      children: (
        <Table
          columns={novelColumns}
          dataSource={novels}
          rowKey="id"
          pagination={false}
          locale={{ emptyText: t("common_no_data") }}
        />
      ),
    },
    {
      key: "quotaChanges",
      label: (
        <Space>
          <EditOutlined /> {t("nav_admin_quota")} ({quotaChangesTotal})
        </Space>
      ),
      children: (
        <Table
          columns={quotaChangeColumns}
          dataSource={quotaChanges}
          rowKey="id"
          pagination={false}
          locale={{ emptyText: t("common_no_data") }}
        />
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => nav("/admin/users")}>
          {t("nav_back")}
        </Button>
      </div>

      <Spin spinning={loading}>
        {err && (
          <div style={{ marginBottom: 16, color: "#ff4d4f" }}>
            {err}
          </div>
        )}

        {user && (
          <div>
            <Card
              className="ops-panel"
              style={{ marginBottom: 24 }}
              title={
                <Space>
                  {user.is_admin && (
                    <Tag icon={<SafetyOutlined />} color="purple">
                      {t("admin_users_is_admin")}
                    </Tag>
                  )}
                  <Title level={4} style={{ margin: 0, color: textColor }}>
                    {user.display_name || user.email}
                  </Title>
                </Space>
              }
              extra={
                <Space>
                  <Button icon={<ReloadOutlined />} onClick={load}>
                    {t("common_refresh")}
                  </Button>
                </Space>
              }
            >
              <div>
                <Paragraph>
                  <Text strong style={{ color: textColor }}>
                    {t("login_email")}:
                  </Text>{" "}
                  <Text style={{ color: textColor }}>{user.email}</Text>
                </Paragraph>
                {user.display_name && (
                  <Paragraph>
                    <Text strong style={{ color: textColor }}>
                      {t("register_display_name")}:
                    </Text>{" "}
                    <Text style={{ color: textColor }}>{user.display_name}</Text>
                  </Paragraph>
                )}
              </div>
            </Card>

            <Tabs defaultActiveKey="overview" items={tabItems} />
          </div>
        )}
      </Spin>

      <Modal
        title={t("admin_quota_edit_title")}
        open={editModalOpen}
        onCancel={() => setEditModalOpen(false)}
        footer={null}
      >
        <Form form={editForm} layout="vertical" onFinish={handleEditQuota}>
          <Form.Item
            name="token_quota"
            label={t("admin_quota_new_quota")}
            rules={[
              {
                validator: (_, value) => {
                  if (value === null || value === undefined || value >= 0) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error("配额不能为负数"));
                },
              },
            ]}
          >
            <InputNumber
              style={{ width: "100%" }}
              placeholder={t("quota_unlimited")}
              addonBefore={
                <Space>
                  <Button
                    type="text"
                    size="small"
                    onClick={() => editForm.setFieldValue("token_quota", null)}
                  >
                    {t("admin_quota_unlimited")}
                  </Button>
                  <Button
                    type="text"
                    size="small"
                    onClick={() => editForm.setFieldValue("token_quota", 0)}
                  >
                    {t("admin_quota_set_zero")}
                  </Button>
                </Space>
              }
            />
          </Form.Item>
          <Form.Item name="reason" label={t("admin_quota_reason")}>
            <Input.TextArea rows={3} placeholder={t("admin_quota_reason")} />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
            <Space>
              <Button onClick={() => setEditModalOpen(false)}>
                {t("common_cancel")}
              </Button>
              <Button type="primary" htmlType="submit">
                {t("common_save")}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
