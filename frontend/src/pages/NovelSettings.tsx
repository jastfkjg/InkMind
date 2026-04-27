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
import { useI18n } from "@/i18n";

type Ctx = { novel: Novel | null; setNovel: React.Dispatch<React.SetStateAction<Novel | null>> };

const { Title, Text } = Typography;
const { TextArea } = Input;

export default function NovelSettings() {
  const { t } = useI18n();
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
      message.success(t("settings_success"));
      setSuccessMsg(t("settings_success"));
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
              {t("loading_novel_info")}
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
              {t("settings_title")}
            </Title>
          </div>
        }
        extra={
          <Text type="secondary">{t("manage_novel_basic_info")}</Text>
        }
      >
        {successMsg && (
          <Alert
            message={t("save_success_title")}
            description={successMsg}
            type="success"
            showIcon
            style={{ marginBottom: "1.5rem" }}
          />
        )}

        {errorMsg && (
          <Alert
            message={t("save_error_title")}
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
                <span>{t("settings_general")}</span>
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
                      <span>{t("novel_title")}</span>
                      <span style={{ color: "#ff4d4f" }}>*</span>
                    </Space>
                  }
                  rules={[{ required: true, message: t("please_enter_novel_title") }]}
                >
                  <Input
                    placeholder={t("enter_novel_title_placeholder")}
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
                      <span>{t("novel_genre")}</span>
                      <AntdTooltip title={t("genre_tooltip")}>
                        <QuestionCircleOutlined
                          style={{ color: "#78716c", cursor: "help" }}
                        />
                      </AntdTooltip>
                    </Space>
                  }
                >
                  <Input
                    placeholder={t("genre_placeholder")}
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
                <span>{t("writing_style_and_background")}</span>
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
                  <span>{t("writing_style")}</span>
                  <AntdTooltip title={t("writing_style_tooltip")}>
                    <QuestionCircleOutlined
                      style={{ color: "#78716c", cursor: "help" }}
                    />
                  </AntdTooltip>
                </Space>
              }
            >
              <TextArea
                rows={2}
                placeholder={t("writing_style_placeholder")}
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
                  <span>{t("background_setting")}</span>
                  <AntdTooltip title={t("background_tooltip")}>
                    <QuestionCircleOutlined
                      style={{ color: "#78716c", cursor: "help" }}
                    />
                  </AntdTooltip>
                </Space>
              }
            >
              <TextArea
                rows={3}
                placeholder={t("background_placeholder")}
                style={{
                  minHeight: 80,
                  lineHeight: 1.8,
                }}
              />
            </Form.Item>
          </Card>

          <Alert
            message={t("tip_title")}
            description={t("tip_description")}
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
              {t("settings_save")}
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
