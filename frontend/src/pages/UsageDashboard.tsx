import { useEffect, useState, type ReactNode } from "react";
import {
  Layout,
  Card,
  Table,
  Button,
  Space,
  Typography,
  Spin,
  Alert,
  Row,
  Col,
  Tag,
  Progress,
} from "antd";
import {
  ArrowLeftOutlined,
  ReloadOutlined,
  RocketOutlined,
  InboxOutlined,
  SendOutlined,
} from "@ant-design/icons";

import AppHeader, { useHeaderTheme } from "@/components/AppHeader";
import { useNavigation } from "@/context/NavigationContext";
import { backDestinationKey } from "@/utils/backDestination";
import "@/styles/workspace-polish.css";
import { useI18n } from "@/i18n";
import { apiErrorMessage, fetchLlmUsage, fetchMyQuota } from "@/api/client";
import type { LlmUsageSummary, TokenQuotaStatus } from "@/types";

const { Content } = Layout;
const { Title, Text } = Typography;

function fmtK(value: number | string | undefined): string {
  const n = typeof value === "number" ? value : 0;
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}K`;
}

export default function UsageDashboard() {
  const { t, isZh } = useI18n();
  const { goBackSmart, lastValidPage } = useNavigation();
  const colors = useHeaderTheme();
  const [data, setData] = useState<LlmUsageSummary | null>(null);
  const [quota, setQuota] = useState<TokenQuotaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const fmtNum = (value: number | string | undefined): string => {
    if (typeof value === "number") {
      return new Intl.NumberFormat(isZh ? "zh-CN" : "en-US").format(value);
    }
    return String(value ?? "0");
  };

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(isZh ? "zh-CN" : "en-US");
  };

  const getActionLabel = (action: string): string => {
    const map: Record<string, string> = {
      generate: "usage_action_generate",
      rewrite: "usage_action_rewrite",
      append: "usage_action_append",
      evaluate: "usage_action_evaluate",
      expand: "usage_action_expand",
      polish: "usage_action_polish",
      naming: "usage_action_naming",
      chat: "usage_action_chat",
      "AI生成": "usage_action_generate",
      "AI改写": "usage_action_rewrite",
      "AI续写": "usage_action_append",
      "AI评估": "usage_action_evaluate",
      "AI扩写": "usage_action_expand",
      "AI润色": "usage_action_polish",
      "AI起名": "usage_action_naming",
      "AI提问": "usage_action_chat",
      "AI标题": "usage_action_title",
      "AI概要灵感": "usage_action_summary_inspire",
      "AI批量生成": "usage_action_batch_generate",
      "自动摘要": "usage_action_auto_summary",
      "后台章节生成": "usage_action_bg_generate",
      "后台批量章节规划": "usage_action_bg_batch_plan",
    };
    if (action.startsWith("后台批量章节生成")) {
      return t("usage_action_bg_batch_generate");
    }
    if (action === "LLM调用") {
      return t("usage_action_llm_call");
    }
    return map[action] ? t(map[action]) : action || "-";
  };

  const getActionTag = (action: string) => {
    const colorMap: Record<string, string> = {
      generate: "blue",
      rewrite: "orange",
      append: "green",
      evaluate: "purple",
      expand: "cyan",
      polish: "geekblue",
      naming: "magenta",
      chat: "gold",
    };
    const color = colorMap[action] || "default";
    return <Tag color={color}>{getActionLabel(action)}</Tag>;
  };

  async function load() {
    setErr("");
    setLoading(true);
    try {
      const [usageData, quotaData] = await Promise.all([
        fetchLlmUsage(200),
        fetchMyQuota().catch(() => null),
      ]);
      setData(usageData);
      if (quotaData) {
        setQuota(quotaData);
      }
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const bgColor = colors.bgColor;
  const bgLinear = colors.bgLinear;
  const bgRadial = colors.bgRadial;
  const textColor = colors.textColor;
  const primaryColor = colors.primaryColor;
  const secondaryTextColor = colors.secondaryTextColor;

  const hasQuota = quota && quota.token_quota !== null;
  const quotaUsed = hasQuota ? quota!.token_quota_used : 0;
  const quotaRemaining = hasQuota
    ? quota!.token_quota_remaining ?? Math.max(0, quota!.token_quota! - quotaUsed)
    : 0;
  const quotaPercent = hasQuota && quota!.token_quota! > 0 ? (quotaUsed / quota!.token_quota!) * 100 : 0;
  const quotaIsLow = hasQuota && quotaRemaining < quota!.token_quota! * 0.2;
  const quotaIsExceeded = hasQuota && quotaRemaining <= 0;
  const quotaStatusColor = quotaIsExceeded ? "#c64545" : quotaIsLow ? "#d4a017" : primaryColor;

  function renderMetricCard({
    title,
    value,
    icon,
    color,
    suffix,
    footer,
  }: {
    title: string;
    value: string;
    icon: ReactNode;
    color: string;
    suffix?: ReactNode;
    footer?: ReactNode;
  }) {
    return (
      <Card className="ops-metric-card">
        <div className="ops-metric-head">
          <span className="ops-metric-label">{title}</span>
          <span className="ops-metric-icon" style={{ color }}>
            {icon}
          </span>
        </div>
        <div className="ops-metric-value" style={{ color }}>
          <span>{value}</span>
          {suffix && <span className="ops-metric-suffix">{suffix}</span>}
        </div>
        {footer}
      </Card>
    );
  }

  const columns = [
    {
      title: t("usage_table_time"),
      dataIndex: "created_at" as const,
      key: "created_at",
      render: (text: string) => <Text type="secondary">{fmtTime(text)}</Text>,
      width: 180,
    },
    {
      title: t("usage_table_action"),
      dataIndex: "action" as const,
      key: "action",
      render: (action: string) => getActionTag(action),
      width: 100,
    },
    {
      title: t("usage_table_provider"),
      dataIndex: "provider" as const,
      key: "provider",
      render: (provider: string, record: { source?: string }) => (
        <Space direction="vertical" size={0}>
          <Text strong style={{ color: primaryColor }}>
            {provider || "-"}
          </Text>
          {record.source === "custom" ? (
            <Tag color="orange" style={{ fontSize: "0.7rem", lineHeight: "1.2", padding: "0 4px" }}>
              {t("ai_settings_custom_tag")}
            </Tag>
          ) : (
            <Tag color="blue" style={{ fontSize: "0.7rem", lineHeight: "1.2", padding: "0 4px" }}>
              {t("ai_settings_builtin_tag")}
            </Tag>
          )}
        </Space>
      ),
      width: 140,
    },
    {
      title: t("usage_table_input"),
      dataIndex: "input_tokens" as const,
      key: "input_tokens",
      render: (n: number) => (
        <Text type="secondary" style={{ fontFamily: "ui-monospace, monospace" }}>
          {fmtK(n)}
        </Text>
      ),
      width: 120,
    },
    {
      title: t("usage_table_output"),
      dataIndex: "output_tokens" as const,
      key: "output_tokens",
      render: (n: number) => (
        <Text type="secondary" style={{ fontFamily: "ui-monospace, monospace" }}>
          {fmtK(n)}
        </Text>
      ),
      width: 120,
    },
    {
      title: t("usage_table_total"),
      dataIndex: "total_tokens" as const,
      key: "total_tokens",
      render: (n: number) => (
        <Text
          strong
          style={{
            fontFamily: "ui-monospace, monospace",
            color: primaryColor,
          }}
        >
          {fmtK(n)}
        </Text>
      ),
      width: 120,
    },
  ];

  return (
    <Layout
      className={`ops-page ${colors.isDark ? "ops-page--dark" : ""}`}
      style={{
        minHeight: "100vh",
        background: bgColor,
        backgroundImage: bgRadial ? `${bgRadial}, ${bgLinear}` : bgLinear,
        transition: "background-color 0.3s ease",
      }}
    >
      <AppHeader
        leftContent={
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <RocketOutlined style={{ fontSize: "1.75rem", color: primaryColor }} />
            <Title level={3} style={{
              margin: 0,
              fontFamily: '"Noto Serif SC", "DM Serif Display", Georgia, serif',
              color: textColor,
              fontSize: "1.35rem",
              transition: "color 0.3s ease",
            }}>
              {t("usage_title")}
            </Title>
          </div>
        }
        extraActions={
          <>
            <Button icon={<ArrowLeftOutlined />} onClick={() => goBackSmart()} size="large" style={{ height: 40 }}>
              {t(backDestinationKey(lastValidPage))}
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading} size="large" style={{ height: 40 }}>
              {t("common_refresh")}
            </Button>
          </>
        }
        disabledMenuItem="usage"
      />

      <Content
        style={{
          padding: "28px",
          maxWidth: 1200,
          margin: "0 auto",
          width: "100%",
        }}
      >
        {err && (
          <Alert
            message={t("common_load_failed")}
            description={err}
            type="error"
            showIcon
            style={{ marginBottom: "1.5rem" }}
          />
        )}

        {data && <>
          <Row gutter={[16, 16]} className="ops-metric-grid" style={{ marginBottom: 16 }}>
            {[
              { title: t("workspace_usage_total"), value: fmtK(data.total_tokens), icon: <RocketOutlined />, color: primaryColor },
              { title: t("usage_table_input"), value: fmtK(data.total_input_tokens), icon: <InboxOutlined />, color: textColor },
              { title: t("usage_table_output"), value: fmtK(data.total_output_tokens), icon: <SendOutlined />, color: textColor },
              { title: t("usage_total_calls"), value: fmtNum(data.total_calls), icon: <RocketOutlined />, color: textColor },
            ].map((metric) => <Col key={metric.title} xs={12} lg={6}>{renderMetricCard(metric)}</Col>)}
          </Row>
          <div className="usage-source-summary" aria-label={t("workspace_usage_sources")}>
            <span>{t("workspace_usage_sources")}</span>
            <span>{t("usage_builtin_tokens")}<strong>{fmtNum(data.builtin_total_tokens)}</strong></span>
            <span>{t("usage_custom_tokens")}<strong>{fmtNum(data.custom_total_tokens)}</strong></span>
          </div>
          {hasQuota && <div className="usage-quota">
            <div className="usage-quota__label"><span>{t("quota_remaining")} <strong>{fmtK(quotaRemaining)} / {fmtK(quota!.token_quota!)}</strong></span><span>{t("quota_used")}: {fmtK(quotaUsed)} · {Math.min(quotaPercent, 100).toFixed(1)}%</span></div>
            <Progress percent={Math.min(quotaPercent, 100)} size="small" showInfo={false} status={quotaIsExceeded ? "exception" : "normal"} strokeColor={quotaStatusColor} />
          </div>}
        </>}
        <p className="workspace-hint">{t("workspace_usage_scope")}</p>

        <Card
          className="ops-panel"
          title={
            <Space>
              <Title
                level={4}
                style={{
                  margin: 0,
                  fontFamily: '"Noto Serif SC", "DM Serif Display", Georgia, serif',
                  color: textColor,
                  transition: "color 0.3s ease",
                }}
              >
                {t("usage_records")}
              </Title>
              {data && (
                <Tag color="default" style={{ margin: 0 }}>
                  {t("usage_records_count").replace("{count}", String(data.items.length))}
                </Tag>
              )}
            </Space>
          }
        >
          <Spin spinning={loading}>
            {!loading && (!data || data.items.length === 0) ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "4rem 2rem",
                }}
              >
                <Text
                  type="secondary"
                  style={{
                    fontSize: "1rem",
                    color: secondaryTextColor,
                  }}
                >
                  {t("usage_no_data_full_desc")}
                </Text>
              </div>
            ) : (
              <Table
                columns={columns}
                dataSource={data?.items || []}
                rowKey="id"
                pagination={{
                  defaultPageSize: 20,
                  showSizeChanger: true,
                  showTotal: (total) => t("usage_total_records").replace("{total}", String(total)),
                  pageSizeOptions: ["10", "20", "50", "100"],
                }}
                scroll={{ x: 800 }}
              />
            )}
          </Spin>
        </Card>
      </Content>
    </Layout>
  );
}
