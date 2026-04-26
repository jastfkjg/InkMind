import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Card,
  Form,
  Input,
  Button,
  Spin,
  Alert,
  Tag,
  Typography,
  Space,
  Tooltip as AntdTooltip,
  message,
  Row,
  Col,
} from "antd";
import {
  SaveOutlined,
  CloseOutlined,
  ArrowLeftOutlined,
  UserOutlined,
  InfoCircleOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";
import NovelAiNamingAskDock from "@/components/NovelAiNamingAskDock";
import { apiErrorMessage, createCharacter, fetchCharacters, updateCharacter } from "@/api/client";

const { Title, Text } = Typography;
const { TextArea } = Input;

export default function NovelPeopleForm() {
  const { novelId, characterId } = useParams();
  const id = Number(novelId);
  const cid = characterId ? Number(characterId) : NaN;
  const isEdit = Number.isFinite(cid);
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
        const list = await fetchCharacters(id);
        const c = list.find((x) => x.id === cid);
        if (!c) {
          setErrorMsg("找不到该人物");
          return;
        }
        form.setFieldsValue({
          name: c.name,
          profile: c.profile,
          notes: c.notes,
        });
      } catch (e) {
        setErrorMsg(apiErrorMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id, cid, isEdit, form]);

  const onFinish = async (values: {
    name: string;
    profile?: string;
    notes?: string;
  }) => {
    setErrorMsg("");
    setSaving(true);
    try {
      if (isEdit) {
        await updateCharacter(id, cid, {
          name: values.name,
          profile: values.profile || "",
          notes: values.notes || "",
        });
        message.success("人物信息已保存");
      } else {
        await createCharacter(id, {
          name: values.name,
          profile: values.profile || "",
          notes: values.notes || "",
        });
        message.success("人物已添加");
      }
      nav(`/novels/${id}/people`);
    } catch (e) {
      setErrorMsg(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
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
              加载人物信息…
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
            <UserOutlined style={{ color: "#7c2d12", fontSize: "1.25rem" }} />
            <Title
              level={4}
              style={{
                margin: 0,
                fontFamily: '"Noto Serif SC", "DM Serif Display", Georgia, serif',
                color: "#1c1917",
              }}
            >
              {isEdit ? "编辑人物" : "新建人物"}
            </Title>
            <Tag color={isEdit ? "blue" : "green"}>
              {isEdit ? "编辑模式" : "新建模式"}
            </Tag>
          </div>
        }
        extra={
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => nav(`/novels/${id}/people`)}
          >
            返回列表
          </Button>
        }
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

        <Form
          form={form}
          name="characterForm"
          onFinish={onFinish}
          layout="vertical"
          initialValues={{
            name: "",
            profile: "",
            notes: "",
          }}
        >
          <Card
            type="inner"
            title={
              <Space>
                <InfoCircleOutlined style={{ color: "#7c2d12" }} />
                <span>基本信息</span>
              </Space>
            }
            style={{
              marginBottom: "1.5rem",
              background: "linear-gradient(180deg, #fff8f0 0%, #fffcf7 100%)",
              borderRadius: 12,
            }}
          >
            <Form.Item
              name="name"
              label={
                <Space>
                  <span>人物姓名</span>
                  <AntdTooltip title="这是人物的核心标识，AI 会在生成内容时参考这个名字">
                    <QuestionCircleOutlined
                      style={{ color: "#78716c", cursor: "help" }}
                    />
                  </AntdTooltip>
                  <span style={{ color: "#ff4d4f" }}>*</span>
                </Space>
              }
              rules={[{ required: true, message: "请输入人物姓名" }]}
            >
              <Input
                placeholder="例如：林清风、叶听雨…"
                size="large"
                prefix={<UserOutlined style={{ color: "#78716c" }} />}
                style={{ height: 44 }}
              />
            </Form.Item>
          </Card>

          <Card
            type="inner"
            title={
              <Space>
                <UserOutlined style={{ color: "#7c2d12" }} />
                <span>人物设定</span>
              </Space>
            }
            style={{
              marginBottom: "1.5rem",
              background: "linear-gradient(180deg, #fff8f0 0%, #fffcf7 100%)",
              borderRadius: 12,
            }}
          >
            <Form.Item
              name="profile"
              label={
                <Space>
                  <span>性格与设定</span>
                  <AntdTooltip title="详细描述人物的性格、外貌、背景、习惯等。这是 AI 保持人物一致性的关键参考">
                    <QuestionCircleOutlined
                      style={{ color: "#78716c", cursor: "help" }}
                    />
                  </AntdTooltip>
                  <Tag color="default">可选</Tag>
                </Space>
              }
            >
              <TextArea
                rows={5}
                placeholder={`例如：
- 性格：冷静理智，外冷内热
- 外貌：黑发黑眸，气质清冷
- 背景：出身书香门第，自幼饱读诗书
- 习惯：思考时喜欢轻敲桌面

越详细的设定，AI 生成的人物形象越一致。`}
                style={{
                  minHeight: 120,
                  lineHeight: 1.8,
                }}
              />
            </Form.Item>
          </Card>

          <Card
            type="inner"
            title={
              <Space>
                <InfoCircleOutlined style={{ color: "#7c2d12" }} />
                <span>补充信息</span>
              </Space>
            }
            style={{
              marginBottom: "1.5rem",
              background: "linear-gradient(180deg, #fff8f0 0%, #fffcf7 100%)",
              borderRadius: 12,
            }}
          >
            <Form.Item
              name="notes"
              label={
                <Space>
                  <span>其他描述</span>
                  <AntdTooltip title="用于记录人物的补充信息，如人际关系、隐藏身份、口头禅等">
                    <QuestionCircleOutlined
                      style={{ color: "#78716c", cursor: "help" }}
                    />
                  </AntdTooltip>
                  <Tag color="default">可选</Tag>
                </Space>
              }
            >
              <TextArea
                rows={3}
                placeholder={`例如：
- 与主角的关系：青梅竹马
- 隐藏身份：某个神秘组织的成员
- 口头禅："凡事都有代价。"

可以记录任何你不想放在主要设定中的补充信息。`}
                style={{
                  minHeight: 80,
                  lineHeight: 1.8,
                }}
              />
            </Form.Item>
          </Card>

          <Alert
            message="小提示"
            description="完善的人物设定可以帮助 AI 生成更一致、更生动的角色形象。建议至少填写人物的核心性格特征。"
            type="info"
            showIcon
            style={{ marginBottom: "1.5rem" }}
          />

          <Form.Item style={{ marginBottom: 0 }}>
            <Row gutter={16}>
              <Col xs={24} sm={12}>
                <Button
                  type="primary"
                  htmlType="submit"
                  icon={<SaveOutlined />}
                  loading={saving}
                  size="large"
                  block
                  style={{
                    height: 44,
                    fontSize: "1rem",
                    fontWeight: 600,
                  }}
                >
                  {isEdit ? "保存修改" : "添加人物"}
                </Button>
              </Col>
              <Col xs={24} sm={12}>
                <Button
                  icon={<CloseOutlined />}
                  onClick={() => nav(`/novels/${id}/people`)}
                  disabled={saving}
                  size="large"
                  block
                  style={{
                    height: 44,
                    fontSize: "1rem",
                  }}
                >
                  取消
                </Button>
              </Col>
            </Row>
          </Form.Item>
        </Form>
      </Card>

      <div style={{ marginTop: "1rem" }}>
        <NovelAiNamingAskDock novelId={id} />
      </div>
    </div>
  );
}
