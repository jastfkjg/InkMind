import { useEffect, useState } from "react";
import { Alert, Space, Progress, Typography, Tag, Tooltip } from "antd";
import { WarningOutlined, CloseCircleOutlined, BarChartOutlined, ReloadOutlined } from "@ant-design/icons";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/i18n";
import { fetchMyQuota } from "@/api/client";
import type { TokenQuotaStatus } from "@/types";

const { Text } = Typography;

export function QuotaWarning() {
  const { user } = useAuth();
  const { isDark } = useTheme();
  const { t, isZh } = useI18n();
  const [quota, setQuota] = useState<TokenQuotaStatus | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      loadQuota();
    }
  }, [user]);

  async function loadQuota() {
    try {
      setLoading(true);
      const q = await fetchMyQuota();
      setQuota(q);
    } catch {
      // Ignore errors - quota check is best effort
    } finally {
      setLoading(false);
    }
  }

  if (!quota || quota.is_unlimited || quota.token_quota === null) {
    return null;
  }

  const total = quota.token_quota;
  const used = quota.token_quota_used;
  const remaining = quota.token_quota_remaining ?? 0;

  const percentage = total > 0 ? (used / total) * 100 : 0;
  const isExceeded = remaining <= 0;
  const isWarning = !isExceeded && remaining < total * 0.2 && remaining < 10000;

  if (!isExceeded && !isWarning) {
    return null;
  }

  const warningColor = isDark ? "#faad14" : "#fa8c16";
  const errorColor = isDark ? "#ff4d4f" : "#ff4d4f";
  const bgColor = isDark ? "#1e1d1b" : "#fffbe6";
  const borderColor = isExceeded ? errorColor : warningColor;

  return (
    <Alert
      message={
        <Space style={{ width: "100%", justifyContent: "space-between", alignItems: "center" }}>
          <Space>
            {isExceeded ? (
              <CloseCircleOutlined style={{ color: errorColor, fontSize: 18 }} />
            ) : (
              <WarningOutlined style={{ color: warningColor, fontSize: 18 }} />
            )}
            <div>
              <Text strong style={{ color: isExceeded ? errorColor : warningColor }}>
                {isExceeded ? t("quota_error_exceeded") : t("quota_warning_low")}
              </Text>
              <div style={{ marginTop: 4 }}>
                <Space size="small">
                  <Tag color={isExceeded ? "red" : "orange"}>
                    {t("quota_used")}: {used.toLocaleString(isZh ? "zh-CN" : "en-US")}
                  </Tag>
                  <Tag color="default">
                    {t("quota_total")}: {total.toLocaleString(isZh ? "zh-CN" : "en-US")}
                  </Tag>
                  <Tag color={remaining > 0 ? "green" : "red"}>
                    {t("quota_remaining")}: {remaining.toLocaleString(isZh ? "zh-CN" : "en-US")}
                  </Tag>
                </Space>
              </div>
            </div>
          </Space>
          <Tooltip title={t("common_refresh")}>
            <ReloadOutlined
              style={{ cursor: "pointer", color: isDark ? "#a3a19b" : "#6c6a64" }}
              onClick={loadQuota}
              spin={loading}
            />
          </Tooltip>
        </Space>
      }
      description={
        <div style={{ marginTop: 8 }}>
          <Progress
            percent={Math.min(percentage, 100)}
            status={isExceeded ? "exception" : "active"}
            strokeColor={isExceeded ? errorColor : warningColor}
            format={(p) => `${p?.toFixed(1) || 0}%`}
          />
          <Text
            type="secondary"
            style={{ fontSize: 12, display: "block", marginTop: 4 }}
          >
            {isExceeded ? t("quota_error_exceeded_desc") : t("quota_warning_low_desc")}
          </Text>
        </div>
      }
      type={isExceeded ? "error" : "warning"}
      showIcon={false}
      style={{
        background: bgColor,
        borderColor: borderColor,
        borderRadius: 8,
        marginBottom: 16,
      }}
    />
  );
}

export function QuotaStatusMini() {
  const { user } = useAuth();
  const { t, isZh } = useI18n();
  const [quota, setQuota] = useState<TokenQuotaStatus | null>(null);

  useEffect(() => {
    if (user) {
      fetchMyQuota().then(setQuota).catch(() => {});
    }
  }, [user]);

  if (!quota || quota.is_unlimited || quota.token_quota === null) {
    return null;
  }

  const total = quota.token_quota;
  const used = quota.token_quota_used;
  const remaining = quota.token_quota_remaining ?? 0;
  const percentage = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const isExceeded = remaining <= 0;
  const isWarning = !isExceeded && remaining < total * 0.2;

  const color = isExceeded ? "#ff4d4f" : isWarning ? "#faad14" : "#52c41a";

  return (
    <Tooltip
      title={
        <div>
          <div>
            {t("quota_used")}: {used.toLocaleString(isZh ? "zh-CN" : "en-US")}
          </div>
          <div>
            {t("quota_total")}: {total.toLocaleString(isZh ? "zh-CN" : "en-US")}
          </div>
          <div>
            {t("quota_remaining")}: {remaining.toLocaleString(isZh ? "zh-CN" : "en-US")}
          </div>
        </div>
      }
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <BarChartOutlined style={{ color }} />
        <Progress
          percent={percentage}
          size="small"
          showInfo={false}
          strokeColor={color}
          style={{ width: 60 }}
        />
      </div>
    </Tooltip>
  );
}
