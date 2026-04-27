import { useEffect, useState } from "react";
import {
  Layout,
  Card,
  Form,
  InputNumber,
  Button,
  Alert,
  Typography,
  Space,
  message,
  Row,
  Col,
  Select,
  Switch,
  Dropdown,
  Avatar,
} from "antd";
import {
  SaveOutlined,
  ArrowLeftOutlined,
  SettingOutlined,
  RobotOutlined,
  CheckCircleOutlined,
  SafetyOutlined,
  EyeOutlined,
  GoldOutlined,
  SunOutlined,
  MoonOutlined,
  UserOutlined,
  BarChartOutlined,
  HistoryOutlined,
  LogoutOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { useNavigation } from "@/context/NavigationContext";

const { Header, Content } = Layout;
const { Title, Text, Paragraph } = Typography;
const { Option } = Select;

type AgentMode = "flexible" | "react" | "direct";

const AGENT_MODE_LABELS: Record<AgentMode, string> = {
  flexible: "Flexible Agent (推荐)",
  react: "ReAct 模式",
  direct: "直接调用 LLM",
};

const AGENT_MODE_DESCRIPTIONS: Record<AgentMode, string> = {
  flexible: "使用 JSON 结构化输出，让模型自主决定何时调用工具和完成任务，灵活性最高。",
  react: "使用 Thought/Action/Observation 格式的 ReAct 循环，可控性强。",
  direct: "直接调用 LLM，不经过 Agent 循环。适合简单任务，速度快、消耗少。",
};

export default function AiSettings() {
  const { user, updateAiSettings, logout } = useAuth();
  const { theme, setTheme, isDark, isSepia } = useTheme();
  const nav = useNavigate();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const { goBackSmart } = useNavigation();

  useEffect(() => {
    if (!user) return;
    form.setFieldsValue({
      agent_mode: user.agent_mode || "flexible",
      max_llm_iterations: user.max_llm_iterations || 10,
      max_tokens_per_task: user.max_tokens_per_task || 50000,
      enable_auto_audit: user.enable_auto_audit ?? true,
      preview_before_save: user.preview_before_save ?? true,
      auto_audit_min_score: user.auto_audit_min_score || 60,
    });
  }, [user, form]);

  const onFinish = async (values: {
    agent_mode: string;
    max_llm_iterations: number;
    max_tokens_per_task: number;
    enable_auto_audit: boolean;
    preview_before_save: boolean;
    auto_audit_min_score: number;
  }) => {
    setErrorMsg("");
    setSuccessMsg("");
    setSaving(true);
    try {
      await updateAiSettings({
        agent_mode: values.agent_mode,
        max_llm_iterations: values.max_llm_iterations,
        max_tokens_per_task: values.max_tokens_per_task,
        enable_auto_audit: values.enable_auto_audit,
        preview_before_save: values.preview_before_save,
        auto_audit_min_score: values.auto_audit_min_score,
      });
      message.success("AI 设置已保存");
      setSuccessMsg("AI 设置已保存");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (e) {
      setErrorMsg(String(e) || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const bgColor = isDark ? "#1a1a2e" : isSepia ? "#f4ecd8" : "#f6f2ea";
  const bgLinear = isDark
    ? "linear-gradient(180deg, #16213e 0%, #1a1a2e 35%)"
    : isSepia
    ? "linear-gradient(180deg, #e8dcc0 0%, #f4ecd8 35%)"
    : "linear-gradient(180deg, #f0e9df 0%, #f6f2ea 35%)";
  const bgRadial = isDark
    ? "none"
    : isSepia
    ? "radial-gradient(ellipse 120% 80% at 50% -20%, #faf6e9 0%, transparent 55%)"
    : "radial-gradient(ellipse 120% 80% at 50% -20%, #fff8f0 0%, transparent 55%)";
  const headerBg = isDark ? "#16213e" : isSepia ? "#faf6e9" : "#fffcf7";
  const headerBorder = isDark ? "#374151" : isSepia ? "#e0d0b0" : "#e7e0d5";
  const textColor = isDark ? "#e8e8e8" : isSepia ? "#5c4b37" : "#1c1917";
  const cardBg = isDark ? "#16213e" : isSepia ? "#faf6e9" : "#fffcf7";
  const secondaryTextColor = isDark ? "#9ca3af" : isSepia ? "#8b7355" : "#57534e";

  const innerCardBg = isDark
    ? "linear-gradient(180deg, #1a1a2e 0%, #16213e 100%)"
    : "linear-gradient(180deg, #fff8f0 0%, #fffcf7 100%)";

  const primaryColor = isDark ? "#f97316" : "#7c2d12";

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
      disabled: true,
    },
    {
      key: "usage",
      icon: <BarChartOutlined />,
      label: "Token 用量",
      onClick: () => nav("/usage"),
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

  const getThemeIcon = () => {
    if (theme === "dark") return <MoonOutlined />;
    if (theme === "sepia") return <EyeOutlined />;
    return <SunOutlined />;
  };

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
          <SettingOutlined
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
            AI 设置
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
          maxWidth: 900,
          margin: "0 auto",
          width: "100%",
        }}
      >
        {successMsg && (
          <Alert
            message="保存成功"
            description={successMsg}
            type="success"
            showIcon
            style={{ marginBottom: "1.5rem" }}
          />
        )}

        {errorMsg && (
          <Alert
            message="保存失败"
            description={errorMsg}
            type="error"
            showIcon
            style={{ marginBottom: "1.5rem" }}
          />
        )}

        <Card
          style={{
            borderRadius: 16,
            border: "none",
            boxShadow: isDark
              ? "0 4px 6px rgba(0, 0, 0, 0.3)"
              : "0 4px 6px rgba(28, 25, 23, 0.06)",
            background: cardBg,
            transition: "background-color 0.3s ease, box-shadow 0.3s ease",
          }}
          title={
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <SettingOutlined
                style={{ color: isDark ? "#f97316" : "#7c2d12", fontSize: "1.25rem" }}
              />
              <Title
                level={4}
                style={{
                  margin: 0,
                  fontFamily: '"Noto Serif SC", "DM Serif Display", Georgia, serif',
                  color: textColor,
                }}
              >
                AI 设置
              </Title>
            </div>
          }
          extra={
            <Text type="secondary" style={{ color: secondaryTextColor }}>
              自定义 AI 行为和生成策略
            </Text>
          }
        >
          <Form
            form={form}
            name="aiSettings"
            onFinish={onFinish}
            layout="vertical"
            initialValues={{
              agent_mode: "flexible",
              max_llm_iterations: 10,
              max_tokens_per_task: 50000,
              enable_auto_audit: true,
              preview_before_save: true,
              auto_audit_min_score: 60,
            }}
          >
            <Card
              type="inner"
              title={
                <Space>
                  <RobotOutlined style={{ color: isDark ? "#f97316" : "#7c2d12" }} />
                  <span style={{ color: textColor }}>Agent 工作模式</span>
                </Space>
              }
              style={{
                marginBottom: "1.5rem",
                background: innerCardBg,
                borderRadius: 12,
              }}
            >
              <Form.Item
                name="agent_mode"
                label={
                  <Text strong style={{ color: textColor }}>
                    选择 Agent 模式
                  </Text>
                }
              >
                <Select size="large" style={{ width: "100%" }}>
                  {(["flexible", "react", "direct"] as AgentMode[]).map((mode) => (
                    <Option key={mode} value={mode}>
                      <Space direction="vertical" size={0} style={{ width: "100%" }}>
                        <Text strong style={{ color: textColor }}>
                          {AGENT_MODE_LABELS[mode]}
                        </Text>
                        <Text type="secondary" style={{ fontSize: "0.8rem", color: secondaryTextColor }}>
                          {AGENT_MODE_DESCRIPTIONS[mode]}
                        </Text>
                      </Space>
                    </Option>
                  ))}
                </Select>
              </Form.Item>

              <Alert
                message="模式说明"
                description={
                  <Paragraph style={{ margin: 0, color: secondaryTextColor }}>
                    <Text strong>Flexible Agent</Text>：适合大多数场景，让 AI 自主决策。
                    <Text strong> ReAct</Text>：需要严格控制 AI 行为时使用。
                    <Text strong> 直接调用</Text>：简单任务（如续写单章节），速度最快、Token 消耗最少。
                  </Paragraph>
                }
                type="info"
                showIcon
                icon={<RobotOutlined />}
                style={{ marginTop: "1rem" }}
              />
            </Card>

            <Card
              type="inner"
              title={
                <Space>
                  <GoldOutlined style={{ color: isDark ? "#f97316" : "#7c2d12" }} />
                  <span style={{ color: textColor }}>资源限制</span>
                </Space>
              }
              style={{
                marginBottom: "1.5rem",
                background: innerCardBg,
                borderRadius: 12,
              }}
            >
              <Row gutter={24}>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="max_llm_iterations"
                    label={
                      <Text strong style={{ color: textColor }}>
                        最大 LLM 交互轮数
                      </Text>
                    }
                    rules={[{ type: "number", min: 1, max: 50, message: "请输入 1-50 之间的数值" }]}
                  >
                    <InputNumber
                      min={1}
                      max={50}
                      size="large"
                      style={{ width: "100%", height: 44 }}
                      addonAfter="轮"
                    />
                  </Form.Item>
                  <Text type="secondary" style={{ fontSize: "0.8rem", color: secondaryTextColor }}>
                    限制 Agent 循环的最大次数，防止无限循环
                  </Text>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="max_tokens_per_task"
                    label={
                      <Text strong style={{ color: textColor }}>
                        最大 Token 消耗阈值
                      </Text>
                    }
                    rules={[{ type: "number", min: 1000, max: 500000, message: "请输入 1000-500000 之间的数值" }]}
                  >
                    <InputNumber
                      min={1000}
                      max={500000}
                      size="large"
                      style={{ width: "100%", height: 44 }}
                      addonAfter="tokens"
                      step={1000}
                    />
                  </Form.Item>
                  <Text type="secondary" style={{ fontSize: "0.8rem", color: secondaryTextColor }}>
                    单次任务的最大 Token 消耗限制
                  </Text>
                </Col>
              </Row>
            </Card>

            <Card
              type="inner"
              title={
                <Space>
                  <SafetyOutlined style={{ color: isDark ? "#f97316" : "#7c2d12" }} />
                  <span style={{ color: textColor }}>质量与安全</span>
                </Space>
              }
              style={{
                marginBottom: "1.5rem",
                background: innerCardBg,
                borderRadius: 12,
              }}
            >
              <Row gutter={24}>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="enable_auto_audit"
                    label={
                      <Text strong style={{ color: textColor }}>
                        自动审核
                      </Text>
                    }
                    valuePropName="checked"
                  >
                    <Switch
                      checkedChildren={<CheckCircleOutlined />}
                      unCheckedChildren="关闭"
                    />
                  </Form.Item>
                  <Text type="secondary" style={{ fontSize: "0.8rem", color: secondaryTextColor }}>
                    生成后自动评估内容质量（去AI化评分、问题点）
                  </Text>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="auto_audit_min_score"
                    label={
                      <Text strong style={{ color: textColor }}>
                        自动审核最低分数
                      </Text>
                    }
                    dependencies={["enable_auto_audit"]}
                    rules={[{ type: "number", min: 0, max: 100, message: "请输入 0-100 之间的数值" }]}
                  >
                    <InputNumber
                      min={0}
                      max={100}
                      size="large"
                      style={{ width: "100%", height: 44 }}
                      addonAfter="分"
                      disabled={!form.getFieldValue("enable_auto_audit")}
                    />
                  </Form.Item>
                  <Text type="secondary" style={{ fontSize: "0.8rem", color: secondaryTextColor }}>
                    低于此分数的内容会标记为需要修订
                  </Text>
                </Col>
              </Row>
            </Card>

            <Card
              type="inner"
              title={
                <Space>
                  <EyeOutlined style={{ color: isDark ? "#f97316" : "#7c2d12" }} />
                  <span style={{ color: textColor }}>预览与确认</span>
                </Space>
              }
              style={{
                marginBottom: "1.5rem",
                background: innerCardBg,
                borderRadius: 12,
              }}
            >
              <Form.Item
                name="preview_before_save"
                label={
                  <Text strong style={{ color: textColor }}>
                    生成后预览确认
                  </Text>
                }
                valuePropName="checked"
              >
                <Switch
                  checkedChildren={<CheckCircleOutlined />}
                  unCheckedChildren="关闭"
                />
              </Form.Item>
              <Alert
                message="推荐开启"
                description={
                  <Paragraph style={{ margin: 0, color: secondaryTextColor }}>
                    开启后，AI 生成的内容会先展示预览，需要你点击确认后才会保存。
                    这样可以避免不满意的内容覆盖现有章节。
                  </Paragraph>
                }
                type="info"
                showIcon
                icon={<EyeOutlined />}
              />
            </Card>

            <Form.Item style={{ marginBottom: 0, marginTop: "1rem" }}>
              <Button
                type="primary"
                htmlType="submit"
                icon={<SaveOutlined />}
                loading={saving}
                size="large"
                style={{
                  height: 44,
                  fontSize: "1rem",
                  fontWeight: 600,
                  paddingLeft: 32,
                  paddingRight: 32,
                }}
              >
                保存设置
              </Button>
            </Form.Item>
          </Form>
        </Card>
      </Content>
    </Layout>
  );
}
