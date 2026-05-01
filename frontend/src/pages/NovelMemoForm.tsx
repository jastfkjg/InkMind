import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Card,
  Form,
  Input,
  Button,
  Spin,
  Alert,
  Typography,
  Space,
  message,
} from "antd";
import {
  SaveOutlined,
  ArrowLeftOutlined,
  FileTextOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";
import { apiErrorMessage, createMemo, fetchMemos, updateMemo } from "@/api/client";
import { useI18n } from "@/i18n";

const { Title, Text } = Typography;
const { TextArea } = Input;

export default function NovelMemoForm() {
  const { t } = useI18n();
  const { novelId, memoId } = useParams();
  const id = Number(novelId);
  const mid = memoId ? Number(memoId) : NaN;
  const isEdit = Number.isFinite(mid);
  const nav = useNavigate();
  const [form] = Form.useForm();

  const [loading, setLoading] = useState(isEdit);
  const [errorMsg, setErrorMsg] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      setErrorMsg("");
      try {
        const list = await fetchMemos(id);
        const m = list.find((x) => x.id === mid);
        if (!m) {
          setErrorMsg(t("memoform_memo_not_found"));
          return;
        }
        form.setFieldsValue({
          title: m.title,
          body: m.body,
        });
      } catch (e) {
        setErrorMsg(apiErrorMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id, mid, isEdit, form, t]);

  async function onFinish(values: { title: string; body: string }) {
    setErrorMsg("");
    setSaving(true);
    try {
      if (isEdit) {
        await updateMemo(id, mid, { title: values.title, body: values.body });
        message.success(t("memoform_updated"));
      } else {
        await createMemo(id, { title: values.title, body: values.body });
        message.success(t("memoform_created"));
      }
      nav(`/novels/${id}/memos`);
    } catch (e) {
      setErrorMsg(apiErrorMessage(e));
      message.error(t("memoform_save_failed"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
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
            background: "#faf9f5",
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
              {t("memoform_loading_memo")}
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
          background: "#faf9f5",
        }}
        title={
          <Space>
            <FileTextOutlined style={{ color: "#cc785c", fontSize: "1.25rem" }} />
            <Title
              level={4}
              style={{
                margin: 0,
                fontFamily: '"Noto Serif SC", "DM Serif Display", Georgia, serif',
                color: "#141413",
              }}
            >
              {isEdit ? t("memoform_edit_memo") : t("memoform_new_memo")}
            </Title>
          </Space>
        }
        extra={
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => nav(`/novels/${id}/memos`)}
          >
            {t("memoform_back_to_list")}
          </Button>
        }
      >
        <Form
          form={form}
          name="memoForm"
          onFinish={onFinish}
          layout="vertical"
          initialValues={{
            title: "",
            body: "",
          }}
        >
          {errorMsg && (
            <Alert
              message={t("operation_failed_title")}
              description={errorMsg}
              type="error"
              showIcon
              style={{ marginBottom: "1.5rem" }}
            />
          )}

          <Card
            type="inner"
            title={
              <Space>
                <FileTextOutlined style={{ color: "#cc785c" }} />
                <span>{t("memoform_memo_info")}</span>
              </Space>
            }
            style={{
              marginBottom: "1.5rem",
              background: "linear-gradient(180deg, #faf9f5 0%, #f5f0e8 100%)",
              borderRadius: 12,
            }}
          >
            <Form.Item
              name="title"
              label={
                <Space>
                  <span>{t("memoform_memo_title")}</span>
                  <Text type="secondary" style={{ fontSize: "0.85rem" }}>
                    {t("memoform_title_optional")}
                  </Text>
                  <Text
                    type="secondary"
                    style={{ fontSize: "0.8rem", cursor: "help" }}
                  >
                    <QuestionCircleOutlined /> {t("memoform_title_tooltip")}
                  </Text>
                </Space>
              }
            >
              <Input
                placeholder={t("memoform_title_placeholder")}
                size="large"
                prefix={<FileTextOutlined style={{ color: "#78716c" }} />}
                style={{ height: 44 }}
              />
            </Form.Item>

            <Form.Item
              name="body"
              label={
                <Space>
                  <span>{t("memoform_memo_content")}</span>
                  <span style={{ color: "#ff4d4f" }}>*</span>
                  <Text
                    type="secondary"
                    style={{ fontSize: "0.8rem", cursor: "help" }}
                  >
                    <QuestionCircleOutlined /> {t("memoform_content_tooltip")}
                  </Text>
                </Space>
              }
              rules={[{ required: true, message: t("memoform_content_required") }]}
            >
              <TextArea
                rows={14}
                placeholder={t("memoform_content_placeholder")}
                style={{
                  minHeight: 280,
                  lineHeight: 1.8,
                  fontSize: "1rem",
                  fontFamily: '"Noto Serif SC", Georgia, serif',
                }}
              />
            </Form.Item>
          </Card>

          <Alert
            message={t("memoform_tip_title")}
            description={t("memoform_tip_content")}
            type="info"
            showIcon
            style={{ marginBottom: "1.5rem" }}
          />

          <Form.Item style={{ marginBottom: 0 }}>
            <Space>
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
                {isEdit ? t("memoform_save_changes") : t("memoform_add_memo")}
              </Button>
              <Button
                size="large"
                onClick={() => nav(`/novels/${id}/memos`)}
                disabled={saving}
                style={{ height: 44 }}
              >
                {t("memoform_cancel")}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
