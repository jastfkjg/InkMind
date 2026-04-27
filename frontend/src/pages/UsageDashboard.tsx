import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Layout,
  Card,
  Table,
  Button,
  Space,
  Typography,
  Spin,
  Alert,
  Statistic,
  Row,
  Col,
  Tag,
  Dropdown,
  Avatar,
} from "antd";
import {
  ArrowLeftOutlined,
  ReloadOutlined,
  RocketOutlined,
  InboxOutlined,
  SendOutlined,
  LogoutOutlined,
  BarChartOutlined,
  SunOutlined,
  MoonOutlined,
  EyeOutlined,
  UserOutlined,
  SettingOutlined,
  HistoryOutlined,
} from "@ant-design/icons";

import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { useNavigation } from "@/context/NavigationContext";
import { apiErrorMessage, fetchLlmUsage } from "@/api/client";
import type { LlmUsageSummary } from "@/types";

const { Header, Content } = Layout;
const { Title, Text } = Typography;

function fmtNum(value: number | string | undefined): string {
  if (typeof value === "number") {
    return new Intl.NumberFormat("zh-CN").format(value);
  }
  return String(value ?? "0");
}

function fmtK(value: number | string | undefined): string {
  const n = typeof value === "number" ? value : 0;
  return `${(n / 1000).toFixed(1)}K`;
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function getActionTag(action: string) {
  const actionMap: Record<string, { color: string; label: string }> = {
    generate: { color: "blue", label: "生成" },
    rewrite: { color: "orange", label: "改写" },
    append: { color: "green", label: "追加" },
    evaluate: { color: "purple", label: "评估" },
    expand: { color: "cyan", label: "扩写" },
    polish: { color: "geekblue", label: "润色" },
    naming: { color: "magenta", label: "起名" },
    chat: { color: "gold", label: "对话" },
  };
  const mapped = actionMap[action];
  if (mapped) {
    return <Tag color={mapped.color}>{mapped.label}</Tag>;
  }
  return <Tag>{action || "-"}</Tag>;
}

export default function UsageDashboard() {
  const { user, logout } = useAuth();
  const { theme, setTheme, isDark, isSepia } = useTheme();
  const nav = useNavigate();
  const { goBackSmart } = useNavigation();
  const [data, setData] = useState<LlmUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  async function load() {
    setErr("");
    setLoading(true);
    try {
      const r = await fetchLlmUsage(200);
      setData(r);
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const themeMenuItems = [
    {
      key: "light",
      icon: <SunOutlined />,
      label: "日间",
      onClick: () => setTheme("light"),
      disabled: theme === "light",
    },
    {
      key: "sepia",
      icon: <EyeOutlined />,
      label: "护眼",
      onClick: () => setTheme("sepia"),
      disabled: theme === "sepia",
    },
    {
      key: "dark",
      icon: <MoonOutlined />,
      label: "夜间",
      onClick: () => setTheme("dark"),
      disabled: theme === "dark",
    },
  ];

  const userMenuItems = [
    {
      key: "settings",
      icon: <SettingOutlined />,
      label: "AI 设置",
      onClick: () => nav("/settings"),
    },
    {
      key: "usage",
      icon: <BarChartOutlined />,
      label: "Token 用量",
      disabled: true,
    },
    {
      key: "tasks",
      icon: <HistoryOutlined />,
      label: "后台任务",
      onClick: () => nav("/tasks"),
    },
    {
      key: "divider",
      type: "divider" as const,
    },
    {
      key: "logout",
      icon: <LogoutOutlined />,
      label: "退出登录",
      danger: true,
      onClick: () => logout(),
    },
  ];

  const bgColor = isDark ? "#1a1a2e" : isSepia ? "#f4ecd8" : "#f6f2ea";
  const bgLinear = isDark ? "linear-gradient(180deg, #16213e 0%, #1a1a2e 35%)" : 
                      isSepia ? "linear-gradient(180deg, #e8dcc0 0%, #f4ecd8 35%)" : 
                      "linear-gradient(180deg, #f0e9df 0%, #f6f2ea 35%)";
  const bgRadial = isDark ? "none" : 
                     isSepia ? "radial-gradient(ellipse 120% 80% at 50% -20%, #faf6e9 0%, transparent 55%)" :
                     "radial-gradient(ellipse 120% 80% at 50% -20%, #fff8f0 0%, transparent 55%)";
  const headerBg = isDark ? "#16213e" : isSepia ? "#faf6e9" : "#fffcf7";
  const headerBorder = isDark ? "#374151" : isSepia ? "#e0d0b0" : "#e7e0d5";
  const textColor = isDark ? "#e8e8e8" : isSepia ? "#5c4b37" : "#1c1917";
  const cardBg = isDark ? "#16213e" : isSepia ? "#faf6e9" : "#fffcf7";
  const primaryColor = isDark ? "#f97316" : "#7c2d12";
  const secondaryTextColor = isDark ? "#9ca3af" : isSepia ? "#8b7355" : "#57534e";

  const getThemeIcon = () => {
    if (theme === "dark") return <MoonOutlined />;
    if (theme === "sepia") return <EyeOutlined />;
    return <SunOutlined />;
  };

  const columns = [
    {
      title: "时间",
      dataIndex: "created_at" as const,
      key: "created_at",
      render: (text: string) => <Text type="secondary">{fmtTime(text)}</Text>,
      width: 180,
    },
    {
      title: "类型",
      dataIndex: "action" as const,
      key: "action",
      render: (action: string) => getActionTag(action),
      width: 100,
    },
    {
      title: "模型厂商",
      dataIndex: "provider" as const,
      key: "provider",
      render: (provider: string) => (
        <Text strong style={{ color: primaryColor }}>
          {provider || "-"}
        </Text>
      ),
      width: 140,
    },
    {
      title: "输入 Token",
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
      title: "输出 Token",
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
      title: "总 Token",
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
      style={{
        minHeight: "100vh",
        background: bgColor,
        backgroundImage: bgRadial ? `${bgRadial}, ${bgLinear}` : bgLinear,
        transition: "background-color 0.3s ease",
      }}
    >
      <Header
        style={{
          padding: "0 2rem",
          background: headerBg,
          borderBottom: `1px solid ${headerBorder}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 72,
          transition: "background-color 0.3s ease, border-color 0.3s ease",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
          }}
        >
          <RocketOutlined
            style={{
              fontSize: "1.75rem",
              color: primaryColor,
            }}
          />
          <Title
            level={3}
            style={{
              margin: 0,
              fontFamily: '"Noto Serif SC", "DM Serif Display", Georgia, serif',
              color: textColor,
              fontSize: "1.35rem",
              transition: "color 0.3s ease",
            }}
          >
            Token 用量统计
          </Title>
        </div>

        <Space size="middle">
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => goBackSmart()}
            size="large"
            style={{ height: 40 }}
          >
            返回
          </Button>
          <Button
            type="primary"
            icon={<ReloadOutlined />}
            onClick={() => void load()}
            loading={loading}
            size="large"
            style={{ height: 40 }}
          >
            刷新
          </Button>

          <Dropdown menu={{ items: themeMenuItems }} placement="bottomRight">
            <Button
              type="text"
              icon={getThemeIcon()}
              size="large"
              style={{
                color: textColor,
                transition: "color 0.3s ease",
              }}
            />
          </Dropdown>

          <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                cursor: "pointer",
                padding: "0.4rem 0.75rem",
                borderRadius: 8,
                transition: "background 0.2s",
              }}
            >
              <Avatar
                size={36}
                icon={<UserOutlined />}
                style={{
                  background: primaryColor,
                  transition: "background-color 0.3s ease",
                }}
              >
                {user?.display_name?.charAt(0) || user?.email?.charAt(0)}
              </Avatar>
              <Text strong style={{ color: textColor, transition: "color 0.3s ease" }}>
                {user?.display_name || user?.email}
              </Text>
            </div>
          </Dropdown>
        </Space>
      </Header>

      <Content
        style={{
          padding: "2rem",
          maxWidth: 1200,
          margin: "0 auto",
          width: "100%",
        }}
      >
        {err && (
          <Alert
            message="加载失败"
            description={err}
            type="error"
            showIcon
            style={{ marginBottom: "1.5rem" }}
          />
        )}

        {data && (
          <Row gutter={[24, 24]} style={{ marginBottom: "1.5rem" }}>
            <Col xs={24} sm={8}>
              <Card
                style={{
                  borderRadius: 16,
                  border: "none",
                  boxShadow: isDark ? "0 4px 6px rgba(0, 0, 0, 0.3)" : "0 4px 6px rgba(28, 25, 23, 0.06)",
                  background: cardBg,
                  transition: "background-color 0.3s ease, box-shadow 0.3s ease",
                }}
              >
                <Statistic
                  title={
                    <Text type="secondary" style={{ fontSize: "0.9rem", color: secondaryTextColor }}>
                      总调用次数
                    </Text>
                  }
                  value={data.total_calls}
                  formatter={fmtNum}
                  valueStyle={{ color: primaryColor, fontFamily: "ui-monospace, monospace" }}
                  prefix={<RocketOutlined style={{ color: primaryColor }} />}
                />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card
                style={{
                  borderRadius: 16,
                  border: "none",
                  boxShadow: isDark ? "0 4px 6px rgba(0, 0, 0, 0.3)" : "0 4px 6px rgba(28, 25, 23, 0.06)",
                  background: cardBg,
                  transition: "background-color 0.3s ease, box-shadow 0.3s ease",
                }}
              >
                <Statistic
                  title={
                    <Text type="secondary" style={{ fontSize: "0.9rem", color: secondaryTextColor }}>
                      总输入 Token
                    </Text>
                  }
                  value={data.total_input_tokens}
                  formatter={fmtK}
                  valueStyle={{ color: isDark ? "#60a5fa" : "#1677ff", fontFamily: "ui-monospace, monospace" }}
                  prefix={<InboxOutlined style={{ color: isDark ? "#60a5fa" : "#4096ff" }} />}
                />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card
                style={{
                  borderRadius: 16,
                  border: "none",
                  boxShadow: isDark ? "0 4px 6px rgba(0, 0, 0, 0.3)" : "0 4px 6px rgba(28, 25, 23, 0.06)",
                  background: cardBg,
                  transition: "background-color 0.3s ease, box-shadow 0.3s ease",
                }}
              >
                <Statistic
                  title={
                    <Text type="secondary" style={{ fontSize: "0.9rem", color: secondaryTextColor }}>
                      总输出 Token
                    </Text>
                  }
                  value={data.total_output_tokens}
                  formatter={fmtK}
                  valueStyle={{ color: isDark ? "#4ade80" : "#52c41a", fontFamily: "ui-monospace, monospace" }}
                  prefix={<SendOutlined style={{ color: isDark ? "#4ade80" : "#73d13d" }} />}
                />
              </Card>
            </Col>
          </Row>
        )}

        <Card
          style={{
            borderRadius: 16,
            border: "none",
            boxShadow: isDark ? "0 4px 6px rgba(0, 0, 0, 0.3)" : "0 4px 6px rgba(28, 25, 23, 0.06)",
            background: cardBg,
            transition: "background-color 0.3s ease, box-shadow 0.3s ease",
          }}
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
                用量记录
              </Title>
              {data && (
                <Tag color="blue" style={{ margin: 0 }}>
                  共 {data.items.length} 条
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
                  暂无用量记录。先使用一次 AI 生成功能再刷新看看。
                </Text>
              </div>
            ) : (
              <Table
                columns={columns}
                dataSource={data?.items || []}
                rowKey="id"
                pagination={{
                  pageSize: 20,
                  showSizeChanger: true,
                  showTotal: (total) => `共 ${total} 条记录`,
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
