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
} from "antd";
import { UserOutlined, LockOutlined, BookOutlined } from "@ant-design/icons";
import { apiErrorMessage } from "@/api/client";
import { useAuth } from "@/context/AuthContext";

const { Title, Text } = Typography;
const { Content } = Layout;

export default function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (user) nav("/", { replace: true });
  }, [user, nav]);

  const onFinish = async (values: { email: string; password: string }) => {
    setErrorMsg("");
    setLoading(true);
    try {
      await login(values.email, values.password);
      message.success("登录成功！");
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
                  InkMind
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
                AI 辅助小说创作平台
              </Title>
              <Text
                style={{
                  fontSize: "1rem",
                  color: "#57534e",
                  lineHeight: 1.8,
                }}
              >
                智能生成章节、改写内容、评估文本，你的全能创作助手。支持多模型 AI
                驱动，一站式小说写作从未如此轻松。
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
                  登录账户
                </Title>
                <Text type="secondary" style={{ fontSize: "0.9rem" }}>
                  欢迎回来，继续你的创作之旅
                </Text>
              </div>

              {errorMsg && (
                <Alert
                  message="登录失败"
                  description={errorMsg}
                  type="error"
                  showIcon
                  style={{ marginBottom: "1rem" }}
                />
              )}

              <Form
                form={form}
                name="login"
                onFinish={onFinish}
                layout="vertical"
                size="large"
              >
                <Form.Item
                  name="email"
                  label="邮箱地址"
                  rules={[
                    { required: true, message: "请输入邮箱地址" },
                    { type: "email", message: "请输入有效的邮箱地址" },
                  ]}
                >
                  <Input
                    prefix={<UserOutlined style={{ color: "#78716c" }} />}
                    placeholder="请输入邮箱地址"
                    autoComplete="email"
                    style={{ height: 44 }}
                  />
                </Form.Item>

                <Form.Item
                  name="password"
                  label="密码"
                  rules={[{ required: true, message: "请输入密码" }]}
                >
                  <Input.Password
                    prefix={<LockOutlined style={{ color: "#78716c" }} />}
                    placeholder="请输入密码"
                    autoComplete="current-password"
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
                    登录
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
                <Text type="secondary">还没有账户？</Text>{" "}
                <Link
                  to="/register"
                  style={{
                    color: "#c2410c",
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  立即注册
                </Link>
              </div>
            </Card>
          </Col>
        </Row>
      </Content>
    </Layout>
  );
}
