import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Table,
  Typography,
  Input,
  Button,
  Space,
  Tag,
  Spin,
  Empty,
  Pagination,
  Tooltip,
  Card,
  Alert,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  SearchOutlined,
  ReloadOutlined,
  SafetyOutlined,
  EditOutlined,
  EyeOutlined,
} from "@ant-design/icons";
import { apiErrorMessage, fetchAdminUsers } from "@/api/client";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/i18n";
import type { AdminUser } from "@/types";

const { Title, Text } = Typography;

export default function AdminUsers() {
  const { isDark } = useTheme();
  const { t, isZh } = useI18n();
  const nav = useNavigate();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [err, setErr] = useState("");

  const textColor = isDark ? "#e7e5e1" : "#141413";
  const secondaryTextColor = isDark ? "#a3a19b" : "#6c6a64";

  async function load() {
    setErr("");
    setLoading(true);
    try {
      const result = await fetchAdminUsers({
        page,
        pageSize,
        search: searchText || undefined,
      });
      setUsers(result.items as AdminUser[]);
      setTotal(result.total);
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [page, pageSize]);

  function handleSearch() {
    setPage(1);
    load();
  }

  function handleRefresh() {
    load();
  }

  function quotaDisplay(quota: number | null) {
    if (quota === null) {
      return <Tag color="green">{t("quota_unlimited")}</Tag>;
    }
    if (quota === 0) {
      return <Tag color="red">0 ({t("dashboard_disabled")})</Tag>;
    }
    return quota.toLocaleString(isZh ? "zh-CN" : "en-US");
  }

  function usedDisplay(used: number, quota: number | null) {
    if (quota === null) {
      return <Tag color="blue">{used.toLocaleString(isZh ? "zh-CN" : "en-US")}</Tag>;
    }
    if (quota === 0) {
      return <Tag color="red">{used.toLocaleString(isZh ? "zh-CN" : "en-US")}</Tag>;
    }
    const pct = (used / quota) * 100;
    let color = "default";
    if (pct >= 100) color = "red";
    else if (pct >= 80) color = "orange";
    else if (pct >= 50) color = "gold";
    return <Tag color={color}>{used.toLocaleString(isZh ? "zh-CN" : "en-US")}</Tag>;
  }

  const columns: ColumnsType<AdminUser> = [
    {
      title: t("login_email"),
      dataIndex: "email",
      key: "email",
      render: (email: string, record) => (
        <div>
          <Text strong style={{ color: textColor }}>
            {email}
          </Text>
          {record.display_name && (
            <div>
              <Text type="secondary" style={{ fontSize: 12, color: secondaryTextColor }}>
                {record.display_name}
              </Text>
            </div>
          )}
        </div>
      ),
    },
    {
      title: t("admin_users_is_admin"),
      dataIndex: "is_admin",
      key: "is_admin",
      width: 100,
      render: (isAdmin: boolean) =>
        isAdmin ? (
          <Tag icon={<SafetyOutlined />} color="purple">
            {t("admin_users_is_admin")}
          </Tag>
        ) : (
          <Tag color="default">{t("admin_users_regular_user")}</Tag>
        ),
    },
    {
      title: t("admin_users_call_count"),
      dataIndex: "llm_call_count",
      key: "llm_call_count",
      width: 120,
      render: (count: number) => count.toLocaleString(isZh ? "zh-CN" : "en-US"),
    },
    {
      title: t("admin_users_quota"),
      dataIndex: "token_quota",
      key: "token_quota",
      width: 150,
      render: (quota: number | null) => quotaDisplay(quota),
    },
    {
      title: t("admin_users_used"),
      dataIndex: "token_quota_used",
      key: "token_quota_used",
      width: 150,
      render: (used: number, record) => usedDisplay(used, record.token_quota),
    },
    {
      title: t("admin_users_created"),
      dataIndex: "created_at",
      key: "created_at",
      width: 180,
      render: (date: string) => new Date(date).toLocaleString(isZh ? "zh-CN" : "en-US"),
    },
    {
      title: t("common_actions"),
      key: "actions",
      width: 150,
      fixed: "right" as const,
      render: (_, record) => (
        <Space>
          <Tooltip title={t("admin_users_view")}>
            <Button
              type="text"
              icon={<EyeOutlined />}
              onClick={() => nav(`/admin/users/${record.id}`)}
              size="small"
            />
          </Tooltip>
          <Tooltip title={t("admin_user_edit_quota")}>
            <Button
              type="text"
              icon={<EditOutlined />}
              onClick={() => nav(`/admin/users/${record.id}`)}
              size="small"
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div className="ops-admin-toolbar">
        <div>
          <Title level={3} style={{ margin: 0, color: textColor }}>
            {t("admin_users_title")}
          </Title>
          <Text type="secondary" style={{ color: secondaryTextColor }}>
            {t("admin_users_subtitle")}
          </Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={handleRefresh} loading={loading}>
          {t("common_refresh")}
        </Button>
      </div>

      <Card className="ops-panel">
        <div className="ops-filter-row">
          <Input
            placeholder={t("admin_users_search")}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            prefix={<SearchOutlined />}
            style={{ maxWidth: 420 }}
            allowClear
            onClear={() => {
              setSearchText("");
              setPage(1);
              load();
            }}
          />
          <Button type="primary" onClick={handleSearch} icon={<SearchOutlined />}>
            {t("common_search")}
          </Button>
          <div className="ops-filter-row__spacer" />
          <Tag color="default" style={{ margin: 0, padding: "4px 10px" }}>
            {t("admin_users_total").replace("{count}", String(total))}
          </Tag>
        </div>

      <Spin spinning={loading}>
        {err && (
          <Alert
            type="error"
            showIcon
            message={t("common_load_failed")}
            description={err}
            style={{ marginBottom: 16 }}
          />
        )}

        {users.length === 0 && !loading ? (
          <Empty description={t("common_no_data")} />
        ) : (
          <>
            <Table
              columns={columns}
              dataSource={users}
              rowKey="id"
              pagination={false}
              scroll={{ x: 1000 }}
              onRow={(record) => ({
                onClick: () => nav(`/admin/users/${record.id}`),
                style: { cursor: "pointer" },
              })}
            />
            <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
              <Pagination
                current={page}
                pageSize={pageSize}
                total={total}
                onChange={(p, ps) => {
                  setPage(p);
                  setPageSize(ps);
                }}
                showSizeChanger
                showTotal={(count) =>
                  t("admin_users_total").replace("{count}", String(count))
                }
              />
            </div>
          </>
        )}
      </Spin>
      </Card>
    </div>
  );
}
