import { useEffect, useState, useCallback } from "react";
import {
  Layout, Card, Form, InputNumber, Button, Alert, Typography, Space,
  message, Row, Col, Select, Switch, Input, Tooltip, Modal, Tag, Spin,
  Popconfirm,
} from "antd";
import type { FormInstance } from "antd";
import {
  SaveOutlined, ArrowLeftOutlined, SettingOutlined, RobotOutlined,
  CheckCircleOutlined, SafetyOutlined, EyeOutlined, GoldOutlined,
  GlobalOutlined, ThunderboltOutlined, QuestionCircleOutlined,
  PlusOutlined, DeleteOutlined, EditOutlined, SwapOutlined,
  LinkOutlined,
} from "@ant-design/icons";
import ConnectionModelFields from "@/components/ConnectionModelFields";
import RoleModelField from "@/components/RoleModelField";
import AppHeader, { useHeaderTheme } from "@/components/AppHeader";
import { useAuth } from "@/context/AuthContext";
import { useNavigation } from "@/context/NavigationContext";
import { backDestinationKey } from "@/utils/backDestination";
import "@/styles/workspace-polish.css";
import { useI18n } from "@/i18n";
import {
  fetchLlmProviders,
  isDesktopApp,
  createCustomLLM,
  updateCustomLLM,
  deleteCustomLLM,
} from "@/api/client";
import type { LlmProvidersResponse, CustomLlmInfo } from "@/types";

import { llmSelection, llmProviderSelection } from "@/utils/llmSelection";

const { Content } = Layout;
const { Title, Text, Paragraph } = Typography;
const { Option } = Select;
const { Password } = Input;

type AgentMode = "flexible" | "react" | "direct";
type ClaudeAuthMode = "auto" | "api_key" | "auth_token";

const ALL_PROVIDERS = [
  { value: "openai", label: "OpenAI", defaultUrl: "https://api.openai.com/v1" },
  { value: "qwen", label: "Qwen / 通义千问", defaultUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  { value: "deepseek", label: "DeepSeek", defaultUrl: "https://api.deepseek.com" },
  { value: "minimax", label: "MiniMax", defaultUrl: "https://api.minimax.io/v1" },
  { value: "kimi", label: "Kimi / 月之暗面", defaultUrl: "https://api.moonshot.ai/v1" },
  { value: "glm", label: "GLM / 智谱", defaultUrl: "https://open.bigmodel.cn/api/paas/v4" },
  { value: "anthropic", label: "Anthropic", defaultUrl: "https://api.anthropic.com" },
];

function isMasked(value: string | null | undefined): boolean {
  return !!value && value.includes("***");
}

function ClaudeAuthModeField({ form }: { form: FormInstance }) {
  const { t } = useI18n();
  return (
    <Form.Item noStyle shouldUpdate={(previous, current) => previous.protocol !== current.protocol}>
      {() => form.getFieldValue("protocol") === "anthropic" ? (
        <Form.Item
          name="claude_auth_mode"
          label={t("ai_settings_claude_auth_mode")}
          extra={t("ai_settings_claude_auth_mode_hint")}
          rules={[{ required: true }]}
        >
          <Select
            size="large"
            options={[
              { value: "auto", label: t("ai_settings_claude_auth_auto") },
              { value: "api_key", label: t("ai_settings_claude_auth_api_key") },
              { value: "auth_token", label: t("ai_settings_claude_auth_token") },
            ]}
          />
        </Form.Item>
      ) : null}
    </Form.Item>
  );
}

type ProviderValue =
  | { kind: "builtin"; providerId: string }
  | { kind: "custom"; customLlmId: number };

function decodeProviderValue(s: string): ProviderValue {
  if (s.startsWith("builtin:")) return { kind: "builtin", providerId: s.slice(8) };
  if (s.startsWith("custom:")) return { kind: "custom", customLlmId: Number(s.slice(7)) };
  return { kind: "builtin", providerId: s };
}

export default function AiSettings() {
  const { user, updateAiSettings, refreshUser } = useAuth();
  const { t } = useI18n();
  const colors = useHeaderTheme();
  const { goBackSmart, lastValidPage } = useNavigation();
  const [form] = Form.useForm();
  const [settingsSection, setSettingsSection] = useState("connections");
  const autoAuditEnabled = Form.useWatch("enable_auto_audit", form);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const [providerInfo, setProviderInfo] = useState<LlmProvidersResponse | null>(null);

  const [genProviderValue, setGenProviderValue] = useState<string>("");
  const [genModel, setGenModel] = useState<string>("");
  const [genSaving, setGenSaving] = useState(false);

  const [agentProviderValue, setAgentProviderValue] = useState<string>("");
  const [agentModel, setAgentModel] = useState<string>("");
  const [agentSaving, setAgentSaving] = useState(false);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingCustom, setEditingCustom] = useState<CustomLlmInfo | null>(null);
  const [addForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [addSaving, setAddSaving] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  const loadProviderInfo = useCallback(async () => {
    try {
      const data = await fetchLlmProviders();
      setProviderInfo(isDesktopApp ? { ...data, builtin: [], agent_builtin: null, default: "" } : data);
      return data;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    loadProviderInfo();
  }, [loadProviderInfo]);

  useEffect(() => {
    if (!user || !providerInfo) return;

    const selected = llmSelection(user, providerInfo, isDesktopApp);
    setGenProviderValue(selected.generationProvider);
    setGenModel(selected.generationModel);
    setAgentProviderValue(selected.agentProvider);
    setAgentModel(selected.agentModel);
  }, [user, providerInfo]);

  useEffect(() => {
    if (!user) return;
    form.setFieldsValue({
      agent_mode: user.agent_mode || "flexible",
      max_llm_iterations: user.max_llm_iterations || 10,
      max_tokens_per_task: user.max_tokens_per_task || 50000,
      enable_auto_audit: user.enable_auto_audit ?? true,
      preview_before_save: user.preview_before_save ?? true,
      auto_audit_min_score: user.auto_audit_min_score ?? 60,
      ai_language: user.ai_language || null,
    });
  // Switching a model must not discard edits in another settings section.
  }, [user?.id, user?.agent_mode, user?.max_llm_iterations, user?.max_tokens_per_task,
    user?.enable_auto_audit, user?.preview_before_save, user?.auto_audit_min_score, user?.ai_language, form]);

  const getModelsForProviderValue = useCallback(
    (pv: string): string[] => {
      const decoded = decodeProviderValue(pv);
      if (decoded.kind === "builtin") {
        return providerInfo?.builtin.find((p) => p.id === decoded.providerId)?.models || [];
      }
      const customLlm = providerInfo?.custom_llms.find((c) => c.id === decoded.customLlmId);
      return [...new Set([customLlm?.default_model, ...(customLlm?.models || [])].filter((model): model is string => !!model))];
    },
    [providerInfo]
  );

  const saveGenProviderModel = useCallback(
    async (pv: string, model: string | null) => {
      setGenSaving(true);
      try {
        const decoded = decodeProviderValue(pv);
        if (decoded.kind === "builtin") {
          await updateAiSettings({
            preferred_llm_provider: decoded.providerId,
            preferred_llm_model: model || null,
            generation_use_custom: false,
            generation_custom_llm_id: null,
          });
        } else {
          await updateAiSettings({
            generation_use_custom: true,
            generation_custom_llm_id: decoded.customLlmId,
            preferred_llm_model: model || null,
          });
        }
        message.success(t("ai_settings_switch_success"));
      } catch (e) {
        message.error(String(e));
        if (user && providerInfo) {
          const selected = llmSelection(user, providerInfo, isDesktopApp);
          setGenProviderValue(selected.generationProvider);
          setGenModel(selected.generationModel);
        }
      } finally {
        setGenSaving(false);
      }
    },
    [updateAiSettings, t, user, providerInfo]
  );

  const handleGenProviderChange = useCallback(
    async (newPv: string) => {
      setGenProviderValue(newPv);
      const selection = llmProviderSelection(providerInfo, newPv, "generation");
      setGenModel(selection.model);
      await saveGenProviderModel(newPv, selection.savedModel);
    },
    [providerInfo, saveGenProviderModel]
  );

  const handleGenModelChange = useCallback(
    async (newModel: string) => {
      setGenModel(newModel);
      await saveGenProviderModel(genProviderValue, newModel);
    },
    [genProviderValue, saveGenProviderModel]
  );

  const saveAgentProviderModel = useCallback(
    async (pv: string, model: string | null) => {
      setAgentSaving(true);
      try {
        const decoded = decodeProviderValue(pv);
        if (decoded.kind === "builtin") {
          await updateAiSettings({
            agent_use_custom: false,
            agent_custom_llm_id: null,
            agent_model: model || null,
          });
        } else {
          await updateAiSettings({
            agent_use_custom: true,
            agent_custom_llm_id: decoded.customLlmId,
            agent_model: model || null,
          });
        }
        message.success(t("ai_settings_switch_success"));
      } catch (e) {
        message.error(String(e));
        if (user && providerInfo) {
          const selected = llmSelection(user, providerInfo, isDesktopApp);
          setAgentProviderValue(selected.agentProvider);
          setAgentModel(selected.agentModel);
        }
      } finally {
        setAgentSaving(false);
      }
    },
    [updateAiSettings, t, user, providerInfo]
  );

  const handleAgentProviderChange = useCallback(
    async (newPv: string) => {
      setAgentProviderValue(newPv);
      const selection = llmProviderSelection(providerInfo, newPv, "agent");
      setAgentModel(selection.model);
      await saveAgentProviderModel(newPv, selection.savedModel);
    },
    [providerInfo, saveAgentProviderModel]
  );

  const handleAgentModelChange = useCallback(
    async (newModel: string) => {
      setAgentModel(newModel);
      await saveAgentProviderModel(agentProviderValue, newModel);
    },
    [agentProviderValue, saveAgentProviderModel]
  );

  const onFinish = async (values: {
    agent_mode: string;
    max_llm_iterations: number;
    max_tokens_per_task: number;
    enable_auto_audit: boolean;
    preview_before_save: boolean;
    auto_audit_min_score: number;
    ai_language: string | null;
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
        ai_language: values.ai_language,
      });
      message.success(t("ai_settings_save_success"));
      setSuccessMsg(t("ai_settings_save_success"));
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (e) {
      setErrorMsg(String(e) || t("ai_settings_save_failed"));
    } finally {
      setSaving(false);
    }
  };

  const handleAddCustomLlm = async () => {
    const values = await addForm.validateFields();
    setAddSaving(true);
    try {
      await createCustomLLM({
        provider: values.provider,
        protocol: values.protocol,
        claude_auth_mode: values.claude_auth_mode,
        default_model: values.default_model.trim(),
        api_key: values.api_key.trim(),
        base_url: values.base_url?.trim() || null,
      });
      setAddModalOpen(false);
      addForm.resetFields();
      const newData = await loadProviderInfo();
      if (newData) {
        await refreshUser();
      }
      message.success(t("ai_settings_custom_added"));
    } catch (e) {
      message.error(String(e));
    } finally {
      setAddSaving(false);
    }
  };

  const handleEditCustomLlm = async () => {
    if (!editingCustom) return;
    const values = await editForm.validateFields();
    setEditSaving(true);
    try {
      const payload: { default_model?: string; provider?: string; protocol?: "openai" | "anthropic"; claude_auth_mode?: ClaudeAuthMode; api_key?: string; base_url?: string | null } = {
        protocol: values.protocol,
        claude_auth_mode: values.claude_auth_mode,
        default_model: values.default_model.trim(),
      };
      if (values.provider) payload.provider = values.provider;
      if (values.api_key && !isMasked(values.api_key)) {
        payload.api_key = values.api_key.trim();
      }
      if (values.base_url !== undefined) {
        payload.base_url = values.base_url?.trim() || null;
      }
      await updateCustomLLM(editingCustom.id, payload);
      setEditModalOpen(false);
      setEditingCustom(null);
      editForm.resetFields();
      await loadProviderInfo();
      await refreshUser();
      message.success(t("ai_settings_custom_updated"));
    } catch (e) {
      message.error(String(e));
    } finally {
      setEditSaving(false);
    }
  };

  const handleDeleteCustomLlm = async (id: number) => {
    try {
      await deleteCustomLLM(id);
      await loadProviderInfo();
      await refreshUser();
      message.success(t("ai_settings_custom_removed"));
    } catch (e) {
      message.error(String(e));
    }
  };

  const openEditModal = (custom: CustomLlmInfo) => {
    setEditingCustom(custom);
    editForm.setFieldsValue({
      provider: custom.provider,
      protocol: custom.protocol,
      claude_auth_mode: custom.claude_auth_mode || "auto",
      default_model: custom.default_model || "",
      api_key: custom.api_key || "",
      base_url: custom.base_url || "",
    });
    setEditModalOpen(true);
  };

  const openAddModal = () => {
    addForm.setFieldsValue({
      provider: "openai",
      protocol: "openai",
      claude_auth_mode: "auto",
      default_model: "",
      api_key: "",
      base_url: ALL_PROVIDERS[0].defaultUrl,
    });
    setAddModalOpen(true);
  };

  const handleAddProviderChange = (provider: string) => {
    const found = ALL_PROVIDERS.find((p) => p.value === provider);
    if (found) {
      addForm.setFieldsValue({ protocol: provider === "anthropic" ? "anthropic" : "openai", base_url: found.defaultUrl });
    }
  };

  const handleEditProviderChange = (provider: string) => {
    const found = ALL_PROVIDERS.find((p) => p.value === provider);
    if (found) {
      editForm.setFieldsValue({ base_url: (editForm.getFieldValue("protocol") === "anthropic") === (provider === "anthropic") ? found.defaultUrl : "" });
    }
  };

  const getAgentModeLabel = (mode: AgentMode) =>
    t(
      {
        flexible: "ai_settings_flexible",
        react: "ai_settings_react",
        direct: "ai_settings_direct",
      }[mode]
    );
  const getAgentModeDescription = (mode: AgentMode) =>
    t(
      {
        flexible: "ai_settings_flexible_desc",
        react: "ai_settings_react_desc",
        direct: "ai_settings_direct_desc",
      }[mode]
    );

  const bgColor = colors.bgColor;
  const bgLinear = colors.bgLinear;
  const bgRadial = colors.bgRadial;
  const textColor = colors.textColor;
  const secondaryTextColor = colors.secondaryTextColor;
  const innerCardBg = colors.isDark
    ? "linear-gradient(180deg, #1e1d1b 0%, #181715 100%)"
    : "linear-gradient(180deg, #faf9f5 0%, #f5f0e8 100%)";
  const primaryColor = colors.primaryColor;


  const genCurrentModels = genProviderValue ? getModelsForProviderValue(genProviderValue) : [];

  const agentCurrentModels = agentProviderValue ? getModelsForProviderValue(agentProviderValue) : [];

  const agentCurrentModel = agentProviderValue ? agentModel : "";

  return (
    <Layout className="settings-page"
      style={{
        minHeight: "100vh",
        background: bgColor,
        backgroundImage: bgRadial ? `${bgRadial}, ${bgLinear}` : bgLinear,
        transition: "background-color 0.3s ease",
      }}
    >
      <AppHeader
        leftContent={
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <SettingOutlined style={{ fontSize: "1.75rem", color: primaryColor }} />
            <Title
              level={3}
              style={{
                margin: 0,
                fontFamily: '"Noto Serif SC", "DM Serif Display", Georgia, serif',
                color: textColor,
                fontSize: "1.35rem",
              }}
            >
              {t("ai_settings_title")}
            </Title>
          </div>
        }
        extraActions={
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => goBackSmart()}
            size="large"
            style={{ height: 40 }}
          >
            {t(backDestinationKey(lastValidPage))}
          </Button>
        }
        disabledMenuItem="settings"
      />

      <Content style={{ padding: "2rem", maxWidth: 1080, margin: "0 auto", width: "100%" }}>
        {successMsg && (
          <Alert
            message={t("ai_settings_save_success")}
            type="success"
            showIcon
            style={{ marginBottom: "1.5rem" }}
          />
        )}
        {errorMsg && (
          <Alert
            message={t("ai_settings_save_failed")}
            description={errorMsg}
            type="error"
            showIcon
            style={{ marginBottom: "1.5rem" }}
          />
        )}

        <div className="settings-section-nav" role="group" aria-label={t("settings_sections")}>
          {(["connections", "preferences", "advanced"] as const).map((key) => <button key={key} aria-pressed={settingsSection === key} onClick={() => setSettingsSection(key)}>{t(`settings_section_${key}`)}</button>)}
        </div>
        <Card className="settings-form-card">
          <Form form={form} name="aiSettings" onFinish={onFinish} layout="vertical" onFinishFailed={({ errorFields }) => {
            const name = String(errorFields[0]?.name[0] || "");
            setSettingsSection(["agent_mode", "max_llm_iterations", "max_tokens_per_task"].includes(name) ? "advanced" : "preferences");
          }}>
            <section hidden={settingsSection !== "connections"} aria-label={t("settings_section_connections")}>{/* ===== 正文生成 ===== */}
            <Card
              type="inner"
              title={
                <Space>
                  <RobotOutlined style={{ color: primaryColor }} />
                  <span style={{ color: textColor }}>{t("ai_settings_generation_ai")}</span>
                </Space>
              }
              style={{ marginBottom: "1.5rem", background: innerCardBg, borderRadius: 12 }}
            >

              <Row gutter={24}>
                <Col xs={24} md={12}>
                  <div style={{ marginBottom: 8 }}>
                    <Text strong style={{ color: textColor }}>
                      {t("ai_settings_provider")}
                    </Text>
                  </div>
                  <Spin spinning={genSaving} size="small">
                    <Select
                      size="large"
                      style={{ width: "100%" }}
                      value={genProviderValue || undefined}
                      placeholder={t("ai_settings_provider_placeholder")}
                      notFoundContent={t("ai_settings_add_provider_hint")}
                      onSelect={handleGenProviderChange}
                      disabled={genSaving}
                      suffixIcon={
                        genSaving ? (
                          <Spin size="small" />
                        ) : (
                          <SwapOutlined style={{ color: secondaryTextColor }} />
                        )
                      }
                    >
                      {providerInfo?.builtin.map((p) => (
                        <Option key={`builtin:${p.id}`} value={`builtin:${p.id}`}>
                          <Space>
                            {p.label}
                            <Tag
                              color="blue"
                              style={{
                                fontSize: "0.65rem",
                                lineHeight: "1.3",
                                padding: "0 3px",
                                verticalAlign: "middle",
                              }}
                            >
                              {t("ai_settings_builtin_tag")}
                            </Tag>
                          </Space>
                        </Option>
                      ))}
                      {providerInfo?.custom_llms.map((cl) => (
                        <Option key={`custom:${cl.id}`} value={`custom:${cl.id}`}>
                          <Space>
                            {cl.provider_label}
                            <Tag
                              color="orange"
                              style={{
                                fontSize: "0.65rem",
                                lineHeight: "1.3",
                                padding: "0 3px",
                                verticalAlign: "middle",
                              }}
                            >
                              {t("ai_settings_custom_tag")}
                            </Tag>
                          </Space>
                        </Option>
                      ))}
                    </Select>
                  </Spin>
                </Col>
                <Col xs={24} md={12}>
                  <div style={{ marginBottom: 8 }}>
                    <Text strong style={{ color: textColor }}>
                      {t("ai_settings_model")}
                    </Text>
                  </div>
                  <Spin spinning={genSaving} size="small">
                    <RoleModelField key={JSON.stringify([genProviderValue, providerInfo])} target="generation" value={genModel} models={genCurrentModels}
                      disabled={genSaving || !genProviderValue} onSave={handleGenModelChange} />

                  </Spin>
                </Col>
              </Row>
            </Card>

            {/* ===== AI 助手 (Agent) ===== */}
            <Card
              type="inner"
              title={
                <Space>
                  <ThunderboltOutlined style={{ color: primaryColor }} />
                  <span style={{ color: textColor }}>{t("ai_settings_agent_ai")}</span>
                </Space>
              }
              style={{ marginBottom: "1.5rem", background: innerCardBg, borderRadius: 12 }}
            >

              <Row gutter={24}>
                <Col xs={24} md={12}>
                  <div style={{ marginBottom: 8 }}>
                    <Text strong style={{ color: textColor }}>
                      {t("ai_settings_provider")}
                    </Text>
                  </div>
                  <Spin spinning={agentSaving} size="small">
                    <Select
                      size="large"
                      style={{ width: "100%" }}
                      value={agentProviderValue || undefined}
                      placeholder={t("ai_settings_provider_placeholder")}
                      notFoundContent={t("ai_settings_agent_setup_hint")}
                      onSelect={handleAgentProviderChange}
                      disabled={agentSaving}
                      suffixIcon={
                        agentSaving ? (
                          <Spin size="small" />
                        ) : (
                          <SwapOutlined style={{ color: secondaryTextColor }} />
                        )
                      }
                    >
                      {providerInfo?.agent_builtin && (
                        <Option value="builtin:anthropic">
                          <Space>
                            {t("ai_settings_agent_builtin_proxy")}
                            <Tag
                              color="blue"
                              style={{
                                fontSize: "0.65rem",
                                lineHeight: "1.3",
                                padding: "0 3px",
                                verticalAlign: "middle",
                              }}
                            >
                              {t("ai_settings_builtin_tag")}
                            </Tag>
                          </Space>
                        </Option>
                      )}
                      {providerInfo?.custom_llms.filter((cl) => cl.protocol === "anthropic").map((cl) => (
                        <Option key={`custom:${cl.id}`} value={`custom:${cl.id}`}>
                          <Space>
                            {cl.provider_label}
                            <Tag
                              color="orange"
                              style={{
                                fontSize: "0.65rem",
                                lineHeight: "1.3",
                                padding: "0 3px",
                                verticalAlign: "middle",
                              }}
                            >
                              {t("ai_settings_custom_tag")}
                            </Tag>
                          </Space>
                        </Option>
                      ))}
                    </Select>
                  </Spin>
                </Col>
                <Col xs={24} md={12}>
                  <div style={{ marginBottom: 8 }}>
                    <Text strong style={{ color: textColor }}>
                      {t("ai_settings_model")}
                    </Text>
                  </div>
                  <Spin spinning={agentSaving} size="small">
                    <RoleModelField key={JSON.stringify([agentProviderValue, providerInfo])} target="agent" value={agentCurrentModel} models={agentCurrentModels}
                      disabled={agentSaving || !agentProviderValue} onSave={handleAgentModelChange} />

                  </Spin>
                </Col>
              </Row>
              {!agentProviderValue && <Text type="secondary">{t("ai_settings_agent_setup_hint")}</Text>}
            </Card>

            {/* ===== Custom LLM Management ===== */}
            <Card
              type="inner"
              title={
                <Space>
                  <LinkOutlined style={{ color: primaryColor }} />
                  <span style={{ color: textColor }}>
                    {t("ai_settings_custom_llm_management")}
                  </span>
                </Space>
              }
              style={{ marginBottom: "1.5rem", background: innerCardBg, borderRadius: 12 }}
            >
              <Paragraph style={{ color: secondaryTextColor, marginBottom: "1rem" }}>
                {t("ai_settings_custom_llm_management_desc")}
              </Paragraph>
              <Button
                icon={<PlusOutlined />}
                onClick={openAddModal}
                style={{ marginBottom: "1rem" }}
              >
                {t("ai_settings_add_custom")}
              </Button>
              {providerInfo?.custom_llms.length === 0 && (
                <div
                  style={{
                    padding: "1.5rem",
                    textAlign: "center",
                    borderRadius: 8,
                    background: colors.isDark
                      ? "rgba(255,255,255,0.03)"
                      : "rgba(0,0,0,0.02)",
                  }}
                >
                  <Text style={{ color: secondaryTextColor }}>
                    {t("ai_settings_no_custom_llms")}
                  </Text>
                </div>
              )}
              {providerInfo?.custom_llms.map((cl) => {
                const isGenSelected =
                  user?.generation_use_custom &&
                  user.generation_custom_llm_id === cl.id;
                const isAgentSelected =
                  user?.agent_use_custom && user.agent_custom_llm_id === cl.id;
                return (
                  <div
                    key={cl.id}
                    style={{
                      padding: "0.75rem 1rem",
                      borderRadius: 8,
                      border: `1px solid ${colors.isDark ? "#3a3530" : "#e6dfd8"}`,
                      marginBottom: "0.5rem",
                      background: colors.isDark
                        ? "rgba(255,255,255,0.03)"
                        : "rgba(255,255,255,0.5)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                        gap: 8,
                      }}
                    >
                      <div className="custom-llm-identity" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Text strong style={{ color: textColor }}>
                          {cl.provider_label}
                        </Text>
                        <Tag color="orange" style={{ fontSize: "0.7rem", lineHeight: "1.4", padding: "0 4px" }}>
                          {t("ai_settings_custom_tag")}
                        </Tag>
                        {isGenSelected && (
                          <Tag
                            color="green"
                            style={{ fontSize: "0.7rem", lineHeight: "1.4", padding: "0 4px" }}
                          >
                            {t("ai_settings_generation_ai")}
                          </Tag>
                        )}
                        {isAgentSelected && (
                          <Tag
                            color="purple"
                            style={{ fontSize: "0.7rem", lineHeight: "1.4", padding: "0 4px" }}
                          >
                            {t("ai_settings_agent_ai")}
                          </Tag>
                        )}
                      </div>
                      <Space className="custom-llm-actions" size={4} wrap>
                        <Button
                          size="small"
                          icon={<EditOutlined />}
                          onClick={() => openEditModal(cl)}
                        >
                          {t("ai_settings_edit_custom")}
                        </Button>
                        <Popconfirm
                          title={t("ai_settings_delete_custom_confirm")}
                          onConfirm={() => handleDeleteCustomLlm(cl.id)}
                          okText={t("ai_settings_confirm_delete")}
                          cancelText={t("ai_settings_cancel")}
                        >
                          <Button size="small" icon={<DeleteOutlined />} danger>
                            {t("ai_settings_remove_custom")}
                          </Button>
                        </Popconfirm>
                      </Space>
                    </div>
                    <details className="custom-llm-details"><summary>{t("llm_details")}</summary>
                      <Text
                        type="secondary"
                        style={{ color: secondaryTextColor, fontSize: "0.8rem" }}
                      >
                        API Key: {cl.api_key || "-"}
                      </Text>
                      {cl.base_url && (
                        <Text
                          type="secondary"
                          style={{
                            color: secondaryTextColor,
                            fontSize: "0.8rem",
                            marginLeft: 12,
                          }}
                        >
                          URL: {cl.base_url}
                        </Text>
                      )}
                      <p>{t("ai_settings_available_models")}: {cl.models.join(", ") || "-"}</p>
                    </details>
                    <div style={{ marginTop: 2 }}>
                      <Text
                        type="secondary"
                        style={{ color: secondaryTextColor, fontSize: "0.75rem" }}
                      >
                        {t("ai_settings_protocol")}: {t(cl.protocol === "anthropic" ? "ai_settings_protocol_anthropic" : "ai_settings_protocol_openai")}
                        <br />
                        {t("llm_default_model")}: {cl.default_model || "—"}
                      </Text>
                    </div>
                  </div>
                );
              })}
            </Card>

            </section>
<section hidden={settingsSection !== "preferences"} aria-label={t("settings_section_preferences")}><p className="settings-section-hint">{t("settings_hint_preferences")}</p>{/* ===== Preview ===== */}
            <Card
              type="inner"
              title={
                <Space>
                  <EyeOutlined style={{ color: primaryColor }} />
                  <span style={{ color: textColor }}>
                    {t("ai_settings_preview_confirm")}
                  </span>
                </Space>
              }
              style={{ marginBottom: "1.5rem", background: innerCardBg, borderRadius: 12 }}
            >
              <Form.Item
                name="preview_before_save"
                label={
                  <Text strong style={{ color: textColor }}>
                    {t("ai_settings_preview_confirm")}
                  </Text>
                }
                valuePropName="checked"
              >
                <Switch
                  checkedChildren={<CheckCircleOutlined />}
                  unCheckedChildren={t("ai_settings_switch_off")}
                />
              </Form.Item>
              <Alert
                message={t("ai_settings_preview_confirm_recommended")}
                description={
                  <Paragraph style={{ margin: 0, color: secondaryTextColor }}>
                    {t("ai_settings_preview_confirm_note")}
                  </Paragraph>
                }
                type="info"
                showIcon
                icon={<EyeOutlined />}
              />
            </Card>

{/* ===== Quality & Safety ===== */}
            <Card
              type="inner"
              title={
                <Space>
                  <SafetyOutlined style={{ color: primaryColor }} />
                  <span style={{ color: textColor }}>
                    {t("ai_settings_quality_safety")}
                  </span>
                </Space>
              }
              style={{ marginBottom: "1.5rem", background: innerCardBg, borderRadius: 12 }}
            >
              <Row gutter={24}>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="enable_auto_audit"
                    label={
                      <Text strong style={{ color: textColor }}>
                        {t("ai_settings_auto_audit")}
                      </Text>
                    }
                    valuePropName="checked"
                  >
                    <Switch
                      checkedChildren={<CheckCircleOutlined />}
                      unCheckedChildren={t("ai_settings_switch_off")}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="auto_audit_min_score"
                    label={
                      <Text strong style={{ color: textColor }}>
                        {t("ai_settings_auto_audit_min_score")}
                      </Text>
                    }
                    rules={[{ type: "number", min: 0, max: 100 }]}
                  >
                    <InputNumber
                      min={0}
                      max={100}
                      size="large"
                      style={{ width: "100%", height: 44 }}
                      addonAfter={t("common_points")}
                      disabled={!autoAuditEnabled}
                    />
                  </Form.Item>
                </Col>
              </Row>
            </Card>

            {/* ===== AI Language ===== */}
            <Card
              type="inner"
              title={
                <Space>
                  <GlobalOutlined style={{ color: primaryColor }} />
                  <span style={{ color: textColor }}>
                    {t("ai_settings_ai_language")}
                  </span>
                </Space>
              }
              style={{ marginBottom: "1.5rem", background: innerCardBg, borderRadius: 12 }}
            >
              <Form.Item
                name="ai_language"
                label={
                  <Text strong style={{ color: textColor }}>
                    {t("ai_settings_ai_language")}
                  </Text>
                }
              >
                <Select size="large" style={{ width: "100%" }}>
                  <Option value={null}>
                    <Text strong style={{ color: textColor }}>
                      {t("ai_settings_ai_language_follow_ui")}
                    </Text>
                  </Option>
                  <Option value="zh">
                    <Text strong style={{ color: textColor }}>
                      中文
                    </Text>
                  </Option>
                  <Option value="en">
                    <Text strong style={{ color: textColor }}>
                      English
                    </Text>
                  </Option>
                </Select>
              </Form.Item>
            </Card>

            </section>
<section hidden={settingsSection !== "advanced"} aria-label={t("settings_section_advanced")}><p className="settings-section-hint">{t("settings_hint_advanced")}</p>{/* ===== Agent Mode ===== */}
            <Card
              type="inner"
              title={
                <Space>
                  <RobotOutlined style={{ color: primaryColor }} />
                  <span style={{ color: textColor }}>
                    {t("ai_settings_agent_mode")}
                  </span>
                </Space>
              }
              style={{ marginBottom: "1.5rem", background: innerCardBg, borderRadius: 12 }}
            >
              <Form.Item
                name="agent_mode"
                label={
                  <Text strong style={{ color: textColor }}>
                    {t("ai_settings_select_mode")}
                  </Text>
                }
              >
                <Select size="large" style={{ width: "100%" }}>
                  {(["flexible", "react", "direct"] as AgentMode[]).map((mode) => (
                    <Option key={mode} value={mode}>
                      <Space direction="vertical" size={0} style={{ width: "100%" }}>
                        <Text strong style={{ color: textColor }}>
                          {getAgentModeLabel(mode)}
                        </Text>
                        <Text
                          type="secondary"
                          style={{ fontSize: "0.8rem", color: secondaryTextColor }}
                        >
                          {getAgentModeDescription(mode)}
                        </Text>
                      </Space>
                    </Option>
                  ))}
                </Select>
              </Form.Item>
              <Alert
                message={t("ai_settings_mode_note_title")}
                description={
                  <Paragraph style={{ margin: 0, color: secondaryTextColor }}>
                    {t("ai_settings_mode_note")}
                  </Paragraph>
                }
                type="info"
                showIcon
                icon={<RobotOutlined />}
                style={{ marginTop: "1rem" }}
              />
            </Card>

            {/* ===== Resource Limits ===== */}
            <Card
              type="inner"
              title={
                <Space>
                  <GoldOutlined style={{ color: primaryColor }} />
                  <span style={{ color: textColor }}>
                    {t("ai_settings_resource_limit")}
                  </span>
                </Space>
              }
              style={{ marginBottom: "1.5rem", background: innerCardBg, borderRadius: 12 }}
            >
              <Row gutter={24}>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="max_llm_iterations"
                    label={
                      <Text strong style={{ color: textColor }}>
                        {t("ai_settings_max_iterations")}
                      </Text>
                    }
                    rules={[{ type: "number", min: 1, max: 50 }]}
                  >
                    <InputNumber
                      min={1}
                      max={50}
                      size="large"
                      style={{ width: "100%", height: 44 }}
                      addonAfter={t("common_rounds")}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="max_tokens_per_task"
                    label={
                      <Text strong style={{ color: textColor }}>
                        {t("ai_settings_max_tokens")}
                      </Text>
                    }
                    rules={[{ type: "number", min: 1000, max: 500000 }]}
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
                </Col>
              </Row>
            </Card>

            </section>
            {settingsSection !== "connections" && <>
            <p className="settings-section-hint">{t("settings_preferences_save_hint")}</p>
            <Form.Item className="settings-save-row" style={{ marginBottom: 0, marginTop: "1rem" }}>
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
                {t("ai_settings_save_button")}
              </Button>
            </Form.Item>
            </>}
          </Form>
        </Card>
      </Content>

      {/* Add Custom LLM Modal */}
      <Modal
        title={t("ai_settings_add_custom_llm_title")}
        open={addModalOpen}
        onOk={handleAddCustomLlm}
        onCancel={() => setAddModalOpen(false)}
        okText={t("ai_settings_save_button")}
        confirmLoading={addSaving}
        destroyOnClose
        width={520}
        style={{ top: 24 }}
        styles={{ body: { maxHeight: "calc(100dvh - 180px)", overflowY: "auto", paddingRight: 8 } }}
      >
        <Form form={addForm} layout="vertical">
          <Form.Item
            name="provider"
            label={t("ai_settings_provider")}
            rules={[{ required: true, message: t("ai_settings_provider_required") }]}
          >
            <Select
              size="large"
              style={{ width: "100%" }}
              onChange={handleAddProviderChange}
            >
              {ALL_PROVIDERS.map((p) => (
                <Option key={p.value} value={p.value}>
                  {p.label}
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="protocol" label={t("ai_settings_protocol")}
            extra={t("ai_settings_protocol_hint")}
            rules={[{ required: true }]}>
            <Select size="large" onChange={() => addForm.setFieldsValue({ base_url: "" })}
              options={[{ value: "openai", label: t("ai_settings_protocol_openai") },
                { value: "anthropic", label: t("ai_settings_protocol_anthropic") }]} />
          </Form.Item>
          <ClaudeAuthModeField form={addForm} />
          <Form.Item
            name="api_key"
            label={t("ai_settings_api_key")}
            rules={[{ required: true, message: t("ai_settings_api_key_required") }]}
          >
            <Password
              placeholder={t("ai_settings_generation_api_key_placeholder")}
              size="large"
              style={{ height: 44 }}
              visibilityToggle
            />
          </Form.Item>
          <Form.Item
            name="base_url"
            rules={[{ required: true, whitespace: true, message: t("ai_settings_protocol_url_required") }]}
            label={
              <Space>
                <span>{t("ai_settings_base_url")}</span>
                <Tooltip title={t("ai_settings_base_url_tooltip")}>
                  <QuestionCircleOutlined style={{ cursor: "help" }} />
                </Tooltip>
              </Space>
            }
          >
            <Input
              placeholder={t("ai_settings_protocol_url_required")}
              size="large"
              style={{ height: 44 }}
            />
          </Form.Item>
          <ConnectionModelFields form={addForm} />
        </Form>
      </Modal>

      {/* Edit Custom LLM Modal */}
      <Modal
        title={t("ai_settings_edit_custom_llm_title")}
        open={editModalOpen}
        onOk={handleEditCustomLlm}
        onCancel={() => {
          setEditModalOpen(false);
          setEditingCustom(null);
        }}
        okText={t("ai_settings_save_button")}
        confirmLoading={editSaving}
        destroyOnClose
        width={520}
        style={{ top: 24 }}
        styles={{ body: { maxHeight: "calc(100dvh - 180px)", overflowY: "auto", paddingRight: 8 } }}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item
            name="provider"
            label={t("ai_settings_provider")}
            rules={[{ required: true, message: t("ai_settings_provider_required") }]}
          >
            <Select
              size="large"
              style={{ width: "100%" }}
              onChange={handleEditProviderChange}
            >
              {ALL_PROVIDERS.map((p) => (
                <Option key={p.value} value={p.value}>
                  {p.label}
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="protocol" label={t("ai_settings_protocol")}
            extra={t("ai_settings_protocol_hint")}
            rules={[{ required: true }]}>
            <Select size="large" onChange={() => editForm.setFieldsValue({ base_url: "" })}
              options={[{ value: "openai", label: t("ai_settings_protocol_openai") },
                { value: "anthropic", label: t("ai_settings_protocol_anthropic") }]} />
          </Form.Item>
          <ClaudeAuthModeField form={editForm} />
          <Form.Item
            name="api_key"
            label={t("ai_settings_api_key")}
            rules={[{ required: true, message: t("ai_settings_api_key_required") }]}
          >
            <Password
              placeholder={t("ai_settings_generation_api_key_placeholder")}
              size="large"
              style={{ height: 44 }}
              visibilityToggle
            />
          </Form.Item>
          <Form.Item
            name="base_url"
            rules={[{ required: true, whitespace: true, message: t("ai_settings_protocol_url_required") }]}
            label={
              <Space>
                <span>{t("ai_settings_base_url")}</span>
                <Tooltip title={t("ai_settings_base_url_tooltip")}>
                  <QuestionCircleOutlined style={{ cursor: "help" }} />
                </Tooltip>
              </Space>
            }
          >
            <Input
              placeholder={t("ai_settings_protocol_url_required")}
              size="large"
              style={{ height: 44 }}
            />
          </Form.Item>
          <ConnectionModelFields form={editForm} customId={editingCustom?.id} />
        </Form>
      </Modal>
    </Layout>
  );
}
