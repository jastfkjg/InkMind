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
import { useI18n } from "@/i18n";

const { Title, Text } = Typography;
const { TextArea } = Input;

export default function NovelPeopleForm() {
  const { t } = useI18n();
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
          setErrorMsg(t("peopleform_character_not_found"));
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
  }, [id, cid, isEdit, form, t]);

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
        message.success(t("peopleform_saved"));
      } else {
        await createCharacter(id, {
          name: values.name,
          profile: values.profile || "",
          notes: values.notes || "",
        });
        message.success(t("peopleform_added"));
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
              {t("peopleform_loading_character")}
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
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <UserOutlined style={{ color: "#cc785c", fontSize: "1.25rem" }} />
            <Title
              level={4}
              style={{
                margin: 0,
                fontFamily: '"Noto Serif SC", "DM Serif Display", Georgia, serif',
                color: "#141413",
              }}
            >
              {isEdit ? t("peopleform_edit_character") : t("peopleform_new_character")}
            </Title>
            <Tag color={isEdit ? "blue" : "green"}>
              {isEdit ? t("peopleform_edit_mode") : t("peopleform_new_mode")}
            </Tag>
          </div>
        }
        extra={
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => nav(`/novels/${id}/people`)}
          >
            {t("peopleform_back_to_list")}
          </Button>
        }
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
                <InfoCircleOutlined style={{ color: "#cc785c" }} />
                <span>{t("peopleform_basic_info")}</span>
              </Space>
            }
            style={{
              marginBottom: "1.5rem",
              background: "linear-gradient(180deg, #faf9f5 0%, #f5f0e8 100%)",
              borderRadius: 12,
            }}
          >
            <Form.Item
              name="name"
              label={
                <Space>
                  <span>{t("peopleform_character_name")}</span>
                  <AntdTooltip title={t("peopleform_name_tooltip")}>
                    <QuestionCircleOutlined
                      style={{ color: "#78716c", cursor: "help" }}
                    />
                  </AntdTooltip>
                  <span style={{ color: "#ff4d4f" }}>*</span>
                </Space>
              }
              rules={[{ required: true, message: t("peopleform_name_required") }]}
            >
              <Input
                placeholder={t("peopleform_name_placeholder")}
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
                <UserOutlined style={{ color: "#cc785c" }} />
                <span>{t("peopleform_character_profile")}</span>
              </Space>
            }
            style={{
              marginBottom: "1.5rem",
              background: "linear-gradient(180deg, #faf9f5 0%, #f5f0e8 100%)",
              borderRadius: 12,
            }}
          >
            <Form.Item
              name="profile"
              label={
                <Space>
                  <span>{t("peopleform_personality")}</span>
                  <AntdTooltip title={t("peopleform_personality_tooltip")}>
                    <QuestionCircleOutlined
                      style={{ color: "#78716c", cursor: "help" }}
                    />
                  </AntdTooltip>
                  <Tag color="default">{t("peopleform_optional")}</Tag>
                </Space>
              }
            >
              <TextArea
                rows={5}
                placeholder={t("peopleform_personality_placeholder")}
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
                <InfoCircleOutlined style={{ color: "#cc785c" }} />
                <span>{t("peopleform_additional_info")}</span>
              </Space>
            }
            style={{
              marginBottom: "1.5rem",
              background: "linear-gradient(180deg, #faf9f5 0%, #f5f0e8 100%)",
              borderRadius: 12,
            }}
          >
            <Form.Item
              name="notes"
              label={
                <Space>
                  <span>{t("peopleform_other_notes")}</span>
                  <AntdTooltip title={t("peopleform_notes_tooltip")}>
                    <QuestionCircleOutlined
                      style={{ color: "#78716c", cursor: "help" }}
                    />
                  </AntdTooltip>
                  <Tag color="default">{t("peopleform_optional")}</Tag>
                </Space>
              }
            >
              <TextArea
                rows={3}
                placeholder={t("peopleform_notes_placeholder")}
                style={{
                  minHeight: 80,
                  lineHeight: 1.8,
                }}
              />
            </Form.Item>
          </Card>

          <Alert
            message={t("peopleform_tip_title")}
            description={t("peopleform_tip_content")}
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
                  {isEdit ? t("peopleform_save_changes") : t("peopleform_add_character")}
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
                  {t("peopleform_cancel")}
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
