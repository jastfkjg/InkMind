import { useEffect, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import {
  Card,
  Form,
  Input,
  Button,
  Spin,
  Alert,
  Typography,
  Space,
  Tooltip as AntdTooltip,
  message,
  Row,
  Col,
} from "antd";
import {
  SaveOutlined,
  BookOutlined,
  QuestionCircleOutlined,
  BulbOutlined,
  SettingOutlined,
  EditOutlined,
} from "@ant-design/icons";
import { apiErrorMessage, updateNovel } from "@/api/client";
import type { Novel } from "@/types";

type Ctx = { novel: Novel | null; setNovel: React.Dispatch<React.SetStateAction<Novel | null>> };

const { Title, Text } = Typography;
const { TextArea } = Input;

export default function NovelSettings() {
  const { novelId } = useParams();
  const id = Number(novelId);
  const { novel, setNovel } = useOutletContext<Ctx>();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!novel) return;
    form.setFieldsValue({
      title: novel.title,
      background: novel.background,
      genre: novel.genre,
      writingStyle: novel.writing_style,
    });
  }, [novel, form]);

  const onFinish = async (values: {
    title: string;
    background?: string;
    genre?: string;
    writingStyle?: string;
  }) => {
    setErrorMsg("");
    setSuccessMsg("");
    setSaving(true);
    try {
      const n = await updateNovel(id, {
        title: values.title,
        background: values.background || "",
        genre: values.genre || "",
        writing_style: values.writingStyle || "",
      });
      setNovel(n);
      message.success("作品设定已保存");
      setSuccessMsg("作品设定已保存");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (e) {
      setErrorMsg(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (!novel) {
    return (
      <div
        style={{
          padding: "2rem",
          maxWidth: 900,
          margin: "0 auto",
        }}
      >
        <Card
          style={{
            borderRadius: 16,
            border: "none",
            boxShadow: "0 4px 6px rgba(28, 25, 23, 0.06)",
            background: "#fffcf7",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              padding: "4rem 2rem",
            }}
          >
            <Spin size="large" />
            <Text
              type="secondary"
              style={{ marginLeft: "1rem", fontSize: "1rem" }}
            >
              加载作品信息…
            </Text>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "1rem",
        maxWidth: 900,
        margin: "0 auto",
      }}
    >
      <Card
        style={{
          borderRadius: 16,
          border: "none",
          boxShadow: "0 4px 6px rgba(28, 25, 23, 0.06)",
          background: "#fffcf7",
        }}
        title={
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <SettingOutlined style={{ color: "#7c2d12", fontSize: "1.25rem" }} />
            <Title
              level={4}
              style={{
                margin: 0,
                fontFamily: '"Noto Serif SC", "DM Serif Display", Georgia, serif',
                color: "#1c1917",
              }}
            >
              作品设定
            </Title>
          </div>
        }
        extra={
          <Text type="secondary">管理作品的基础信息</Text>
        }
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

        <Form
          form={form}
          name="novelSettings"
          onFinish={onFinish}
          layout="vertical"
          initialValues={{
            title: "",
            background: "",
            genre: "",
            writingStyle: "",
          }}
        >
          <Card
            type="inner"
            title={
              <Space>
                <BookOutlined style={{ color: "#7c2d12" }} />
                <span>基本信息</span>
              </Space>
            }
            style={{
              marginBottom: "1.5rem",
              background: "linear-gradient(180deg, #fff8f0 0%, #fffcf7 100%)",
              borderRadius: 12,
            }}
          >
            <Row gutter={24}>
              <Col xs={24} md={12}>
                <Form.Item
                  name="title"
                  label={
                    <Space>
                      <span>作品名称</span>
                      <span style={{ color: "#ff4d4f" }}>*</span>
                    </Space>
                  }
                  rules={[{ required: true, message: "请输入作品名称" }]}
                >
                  <Input
                    placeholder="输入作品名称"
                    size="large"
                    prefix={<BookOutlined style={{ color: "#78716c" }} />}
                    style={{ height: 44 }}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  name="genre"
                  label={
                    <Space>
                      <span>类型</span>
                      <AntdTooltip title="帮助 AI 更好地理解你的创作风格">
                        <QuestionCircleOutlined
                          style={{ color: "#78716c", cursor: "help" }}
                        />
                      </AntdTooltip>
                    </Space>
                  }
                >
                  <Input
                    placeholder="例如：科幻、武侠、言情、悬疑…"
                    size="large"
                    style={{ height: 44 }}
                  />
                </Form.Item>
              </Col>
            </Row>
          </Card>

          <Card
            type="inner"
            title={
              <Space>
                <EditOutlined style={{ color: "#7c2d12" }} />
                <span>创作风格与背景</span>
              </Space>
            }
            style={{
              marginBottom: "1.5rem",
              background: "linear-gradient(180deg, #fff8f0 0%, #fffcf7 100%)",
              borderRadius: 12,
            }}
          >
            <Form.Item
              name="writingStyle"
              label={
                <Space>
                  <span>写作风格</span>
                  <AntdTooltip title="描述你希望的写作风格，AI 会参考这些信息进行创作">
                    <QuestionCircleOutlined
                      style={{ color: "#78716c", cursor: "help" }}
                    />
                  </AntdTooltip>
                </Space>
              }
            >
              <TextArea
                rows={2}
                placeholder="例如：第三人称、细腻心理描写、节奏偏慢、幽默风格…"
                style={{
                  minHeight: 60,
                  lineHeight: 1.8,
                }}
              />
            </Form.Item>

            <Form.Item
              name="background"
              label={
                <Space>
                  <span>背景设定</span>
                  <AntdTooltip title="这是 AI 生成内容时的重要参考。简洁明了地描述故事发生的世界">
                    <QuestionCircleOutlined
                      style={{ color: "#78716c", cursor: "help" }}
                    />
                  </AntdTooltip>
                </Space>
              }
            >
              <TextArea
                rows={3}
                placeholder="例如：时代、地点、世界观、核心矛盾…（宜短，不必写全书大纲）"
                style={{
                  minHeight: 80,
                  lineHeight: 1.8,
                }}
              />
            </Form.Item>
          </Card>

          <Alert
            message="小提示"
            description="完善的作品设定可以帮助 AI 生成更符合你期望的内容。建议至少填写作品类型和简要的背景设定。"
            type="info"
            showIcon
            icon={<BulbOutlined />}
            style={{ marginBottom: "1.5rem" }}
          />

          <Form.Item style={{ marginBottom: 0 }}>
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
              保存设定
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
