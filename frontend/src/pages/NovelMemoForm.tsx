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

const { Title, Text } = Typography;
const { TextArea } = Input;

export default function NovelMemoForm() {
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
          setErrorMsg("找不到该备忘");
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
  }, [id, mid, isEdit, form]);

  async function onFinish(values: { title: string; body: string }) {
    setErrorMsg("");
    setSaving(true);
    try {
      if (isEdit) {
        await updateMemo(id, mid, { title: values.title, body: values.body });
        message.success("备忘已更新");
      } else {
        await createMemo(id, { title: values.title, body: values.body });
        message.success("备忘已创建");
      }
      nav(`/novels/${id}/memos`);
    } catch (e) {
      setErrorMsg(apiErrorMessage(e));
      message.error("保存失败");
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
              加载备忘信息…
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
          <Space>
            <FileTextOutlined style={{ color: "#7c2d12", fontSize: "1.25rem" }} />
            <Title
              level={4}
              style={{
                margin: 0,
                fontFamily: '"Noto Serif SC", "DM Serif Display", Georgia, serif',
                color: "#1c1917",
              }}
            >
              {isEdit ? "编辑备忘" : "新建备忘"}
            </Title>
          </Space>
        }
        extra={
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => nav(`/novels/${id}/memos`)}
          >
            返回列表
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
              message="操作失败"
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
                <FileTextOutlined style={{ color: "#7c2d12" }} />
                <span>备忘信息</span>
              </Space>
            }
            style={{
              marginBottom: "1.5rem",
              background: "linear-gradient(180deg, #fff8f0 0%, #fffcf7 100%)",
              borderRadius: 12,
            }}
          >
            <Form.Item
              name="title"
              label={
                <Space>
                  <span>标题</span>
                  <Text type="secondary" style={{ fontSize: "0.85rem" }}>
                    （可选）
                  </Text>
                  <Text
                    type="secondary"
                    style={{ fontSize: "0.8rem", cursor: "help" }}
                  >
                    <QuestionCircleOutlined /> 标题用于快速识别备忘内容
                  </Text>
                </Space>
              }
            >
              <Input
                placeholder="简要描述备忘的内容"
                size="large"
                prefix={<FileTextOutlined style={{ color: "#78716c" }} />}
                style={{ height: 44 }}
              />
            </Form.Item>

            <Form.Item
              name="body"
              label={
                <Space>
                  <span>正文</span>
                  <span style={{ color: "#ff4d4f" }}>*</span>
                  <Text
                    type="secondary"
                    style={{ fontSize: "0.8rem", cursor: "help" }}
                  >
                    <QuestionCircleOutlined /> 记录你的备忘内容
                  </Text>
                </Space>
              }
              rules={[{ required: true, message: "请输入备忘内容" }]}
            >
              <TextArea
                rows={14}
                placeholder="记录你的备忘内容…

备忘可以用于：
- 记录灵感和想法
- 保存重要的设定细节
- 记录剧情线索和伏笔
- 保存参考资料和素材"
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
            message="备忘的用途"
            description="备忘是你创作时的得力助手。你可以用它来记录灵感、保存设定细节、追踪剧情线索，或者存放任何对你有帮助的参考资料。建议定期整理你的备忘，保持备忘列表的整洁和高效。"
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
                {isEdit ? "保存修改" : "添加备忘"}
              </Button>
              <Button
                size="large"
                onClick={() => nav(`/novels/${id}/memos`)}
                disabled={saving}
                style={{ height: 44 }}
              >
                取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
