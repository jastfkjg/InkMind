import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Form,
  Input,
  Button,
  Card,
  Typography,
  Alert,
  Layout,
  Row,
  Col,
  message,
  Dropdown,
} from "antd";
import {
  UserOutlined,
  LockOutlined,
  BookOutlined,
  SmileOutlined,
  GlobalOutlined,
} from "@ant-design/icons";
import { apiErrorMessage } from "@/api/client";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/i18n";

const { Title, Text } = Typography;
const { Content } = Layout;

export default function Register() {
  const { user, register } = useAuth();
  const { t, setLanguage, isZh } = useI18n();
  const nav = useNavigate();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (user) nav("/", { replace: true });
  }, [user, nav]);

  const languageMenuItems = [
    {
      key: "zh",
      label: isZh ? "✓ 中文" : "中文",
      onClick: () => setLanguage("zh"),
    },
    {
      key: "en",
      label: !isZh ? "✓ English" : "English",
      onClick: () => setLanguage("en"),
    },
  ];

  const onFinish = async (values: {
    email: string;
    password: string;
    displayName?: string;
  }) => {
    setErrorMsg("");
    setLoading(true);
    try {
      await register(values.email, values.password, values.displayName);
      message.success(t("register_success"));
      nav("/", { replace: true });
    } catch (ex) {
      setErrorMsg(apiErrorMessage(ex));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #f6f2ea 0%, #ebe4d8 100%)",
        backgroundImage: `
          radial-gradient(ellipse 120% 80% at 50% -20%, #fff8f0 0%, transparent 55%),
          linear-gradient(180deg, #f0e9df 0%, #f6f2ea 35%)
        `,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "1rem",
          right: "1rem",
          zIndex: 100,
        }}
      >
        <Dropdown menu={{ items: languageMenuItems }} placement="bottomRight">
          <Button type="text" icon={<GlobalOutlined />} size="large">
            {isZh ? "中文" : "EN"}
          </Button>
        </Dropdown>
      </div>

      <Content
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          padding: "2rem 1rem",
        }}
      >
        <Row gutter={[32, 32]} align="middle" style={{ maxWidth: 1200, width: "100%" }}>
          <Col xs={24} lg={14}>
            <div style={{ padding: "0 1rem" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  marginBottom: "1.5rem",
                }}
              >
                <BookOutlined
                  style={{
                    fontSize: "2.5rem",
                    color: "#7c2d12",
                  }}
                />
                <Title
                  level={1}
                  style={{
                    margin: 0,
                    fontFamily: '"Noto Serif SC", "DM Serif Display", Georgia, serif',
                    color: "#1c1917",
                    fontSize: "2.25rem",
                  }}
                >
                  {t("app_name")}
                </Title>
              </div>
              <Title
                level={2}
                style={{
                  marginBottom: "1rem",
                  fontFamily: '"Source Sans 3", system-ui, sans-serif',
                  fontWeight: 600,
                  color: "#292524",
                  fontSize: "1.5rem",
                }}
              >
                {t("register_welcome_subtitle")}
              </Title>
              <Text
                style={{
                  fontSize: "1rem",
                  color: "#57534e",
                  lineHeight: 1.8,
                }}
              >
                {t("register_welcome_desc")}
              </Text>
            </div>
          </Col>

          <Col xs={24} lg={10}>
            <Card
              bordered={false}
              style={{
                borderRadius: 16,
                boxShadow:
                  "0 4px 6px rgba(28, 25, 23, 0.06), 0 10px 15px rgba(28, 25, 23, 0.03)",
                background: "#fffcf7",
              }}
            >
              <div
                style={{
                  textAlign: "center",
                  marginBottom: "1.5rem",
                }}
              >
                <Title
                  level={3}
                  style={{
                    margin: 0,
                    fontFamily: '"Noto Serif SC", "DM Serif Display", Georgia, serif',
                    color: "#1c1917",
                  }}
                >
                  {t("register_title")}
                </Title>
                <Text type="secondary" style={{ fontSize: "0.9rem" }}>
                  {t("register_subtitle")}
                </Text>
              </div>

              {errorMsg && (
                <Alert
                  message={t("register_failed")}
                  description={errorMsg}
                  type="error"
                  showIcon
                  style={{ marginBottom: "1rem" }}
                />
              )}

              <Form
                form={form}
                name="register"
                onFinish={onFinish}
                layout="vertical"
                size="large"
              >
                <Form.Item
                  name="email"
                  label={t("register_email")}
                  rules={[
                    { required: true, message: t("validation_email_required") },
                    { type: "email", message: t("validation_email_invalid") },
                  ]}
                >
                  <Input
                    prefix={<UserOutlined style={{ color: "#78716c" }} />}
                    placeholder={t("register_email_placeholder")}
                    autoComplete="email"
                    style={{ height: 44 }}
                  />
                </Form.Item>

                <Form.Item
                  name="password"
                  label={t("register_password")}
                  rules={[
                    { required: true, message: t("validation_password_required") },
                    { min: 6, message: t("validation_password_min").replace("{min}", "6") },
                  ]}
                >
                  <Input.Password
                    prefix={<LockOutlined style={{ color: "#78716c" }} />}
                    placeholder={t("register_password_placeholder")}
                    autoComplete="new-password"
                    style={{ height: 44 }}
                  />
                </Form.Item>

                <Form.Item
                  name="displayName"
                  label={t("register_display_name")}
                >
                  <Input
                    prefix={<SmileOutlined style={{ color: "#78716c" }} />}
                    placeholder={t("register_display_name_placeholder")}
                    style={{ height: 44 }}
                  />
                </Form.Item>

                <Form.Item style={{ marginBottom: 0 }}>
                  <Button
                    type="primary"
                    htmlType="submit"
                    loading={loading}
                    block
                    size="large"
                    style={{
                      height: 44,
                      fontSize: "1rem",
                      fontWeight: 600,
                    }}
                  >
                    {t("register_button")}
                  </Button>
                </Form.Item>
              </Form>

              <div
                style={{
                  marginTop: "1.5rem",
                  textAlign: "center",
                  borderTop: "1px solid #e7e0d5",
                  paddingTop: "1.5rem",
                }}
              >
                <Text type="secondary">{t("register_has_account")}</Text>{" "}
                <Link
                  to="/login"
                  style={{
                    color: "#c2410c",
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  {t("register_login_now")}
                </Link>
              </div>
            </Card>
          </Col>
        </Row>
      </Content>
    </Layout>
  );
}
