import { useState, useEffect } from "react";
import {
  Table,
  Typography,
  Button,
  Space,
  Tag,
  Spin,
  Empty,
  Pagination,
  Select,
  Descriptions,
  Modal,
  Card,
  Alert,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  ReloadOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import { apiErrorMessage, fetchAdminLogs } from "@/api/client";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/i18n";
import type { AdminLog } from "@/types";

const { Title, Text } = Typography;

const ACTION_TYPES = [
  { value: "update_quota", label: "update_quota" },
  { value: "reset_quota_usage", label: "reset_quota_usage" },
  { value: "view_user", label: "view_user" },
  { value: "view_logs", label: "view_logs" },
];

function actionDisplay(action: string, t: (key: string) => string) {
  const map: Record<string, { label: string; color: string }> = {
    update_quota: { label: t("action_update_quota"), color: "blue" },
    reset_quota: { label: t("action_reset_quota"), color: "orange" },
    reset_quota_usage: { label: t("action_reset_quota"), color: "orange" },
    view_user: { label: t("action_view_user"), color: "default" },
    view_logs: { label: t("action_view_logs"), color: "default" },
  };
  const item = map[action] || { label: action, color: "default" };
  return <Tag color={item.color}>{item.label}</Tag>;
}

export default function AdminLogs() {
  const { isDark } = useTheme();
  const { t, isZh } = useI18n();
  const [logs, setLogs] = useState<AdminLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [actionFilter, setActionFilter] = useState<string | undefined>();
  const [selectedLog, setSelectedLog] = useState<AdminLog | null>(null);
  const [err, setErr] = useState("");

  const textColor = isDark ? "#e7e5e1" : "#141413";
  const secondaryTextColor = isDark ? "#a3a19b" : "#6c6a64";

  async function load() {
    setErr("");
    setLoading(true);
    try {
      const result = await fetchAdminLogs({
        page,
        pageSize,
        action: actionFilter,
      });
      setLogs(result.items as AdminLog[]);
      setTotal(result.total);
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [page, pageSize, actionFilter]);

  function handleRefresh() {
    load();
  }

  function handleActionFilterChange(value: string | undefined) {
    setActionFilter(value);
    setPage(1);
  }

  const columns: ColumnsType<AdminLog> = [
    {
      title: t("admin_logs_time"),
      dataIndex: "created_at",
      key: "created_at",
      width: 180,
      render: (date: string) => (
        <Text style={{ color: textColor }}>
          {new Date(date).toLocaleString(isZh ? "zh-CN" : "en-US")}
        </Text>
      ),
    },
    {
      title: t("admin_logs_admin"),
      key: "admin",
      width: 180,
      render: (_, record) => (
        <div>
          <Text strong style={{ color: textColor }}>
            {record.admin_email || `ID: ${record.admin_id}`}
          </Text>
        </div>
      ),
    },
    {
      title: t("admin_logs_action"),
      dataIndex: "action",
      key: "action",
      width: 150,
      render: (action: string) => actionDisplay(action, t),
    },
    {
      title: t("admin_logs_target"),
      key: "target",
      width: 180,
      render: (_, record) => {
        if (record.target_user_id === null) return "-";
        return (
          <Text type="secondary" style={{ color: secondaryTextColor }}>
            {record.target_user_email || `ID: ${record.target_user_id}`}
          </Text>
        );
      },
    },
    {
      title: t("admin_logs_details"),
      dataIndex: "details",
      key: "details",
      render: (details: string | null) =>
        details ? (
          <Text ellipsis style={{ maxWidth: 250, color: textColor }}>
            {details}
          </Text>
        ) : (
          "-"
        ),
    },
    {
      title: t("admin_logs_ip"),
      dataIndex: "ip_address",
      key: "ip_address",
      width: 140,
      render: (ip: string | null) => (
        <Text type="secondary" style={{ color: secondaryTextColor }}>
          {ip || "-"}
        </Text>
      ),
    },
  ];

  return (
    <div>
      <div className="ops-admin-toolbar">
        <div>
          <Title level={3} style={{ margin: 0, color: textColor }}>
            <Space>
              <FileTextOutlined />
              {t("admin_logs_title")}
            </Space>
          </Title>
          <Text type="secondary" style={{ color: secondaryTextColor }}>
            {t("admin_logs_subtitle")}
          </Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={handleRefresh} loading={loading}>
          {t("common_refresh")}
        </Button>
      </div>

      <Card className="ops-panel">
        <div className="ops-filter-row">
          <Select
            placeholder={t("admin_logs_filter_action")}
            allowClear
            style={{ width: 220 }}
            value={actionFilter}
            onChange={handleActionFilterChange}
            options={ACTION_TYPES.map((a) => ({
              value: a.value,
              label: t(`action_${a.value}`),
            }))}
          />
          <div className="ops-filter-row__spacer" />
          <Tag color="default" style={{ margin: 0, padding: "4px 10px" }}>
            {t("admin_logs_total").replace("{count}", String(total))}
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

        {logs.length === 0 && !loading ? (
          <Empty description={t("common_no_data")} />
        ) : (
          <>
            <Table
              columns={columns}
              dataSource={logs}
              rowKey="id"
              pagination={false}
              scroll={{ x: 1100 }}
              onRow={(record) => ({
                onClick: () => setSelectedLog(record),
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
                showTotal={(count) => t("admin_logs_total").replace("{count}", String(count))}
              />
            </div>
          </>
        )}
      </Spin>
      </Card>

      {selectedLog && (
        <Modal
          title={t("admin_logs_details")}
          open={!!selectedLog}
          onCancel={() => setSelectedLog(null)}
          footer={
            <Button onClick={() => setSelectedLog(null)}>{t("common_close")}</Button>
          }
          width={600}
        >
          <Descriptions bordered column={1} size="small">
            <Descriptions.Item label={t("admin_logs_time")}>
              {new Date(selectedLog.created_at).toLocaleString(isZh ? "zh-CN" : "en-US")}
            </Descriptions.Item>
            <Descriptions.Item label={t("admin_logs_admin")}>
              {selectedLog.admin_email || `ID: ${selectedLog.admin_id}`}
            </Descriptions.Item>
            <Descriptions.Item label={t("admin_logs_action")}>
              {actionDisplay(selectedLog.action, t)}
            </Descriptions.Item>
            <Descriptions.Item label={t("admin_logs_target")}>
              {selectedLog.target_user_id !== null
                ? `${selectedLog.target_user_email || ""} (ID: ${selectedLog.target_user_id})`
                : "-"}
            </Descriptions.Item>
            {selectedLog.resource_type && (
              <Descriptions.Item label={t("admin_logs_resource_type")}>
                {selectedLog.resource_type}
              </Descriptions.Item>
            )}
            {selectedLog.resource_id !== null && (
              <Descriptions.Item label={t("admin_logs_resource_id")}>{selectedLog.resource_id}</Descriptions.Item>
            )}
            <Descriptions.Item label={t("admin_logs_ip")}>
              {selectedLog.ip_address || "-"}
            </Descriptions.Item>
            <Descriptions.Item label={t("admin_logs_details")}>
              <Text style={{ whiteSpace: "pre-wrap", display: "block" }}>
                {selectedLog.details || "-"}
              </Text>
            </Descriptions.Item>
          </Descriptions>
        </Modal>
      )}
    </div>
  );
}
