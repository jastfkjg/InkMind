import { useEffect, useState, useCallback } from "react";
import {
  Layout, Form, InputNumber, Button, Alert, Typography, Space,
  App as AntApp, Select, Switch, Input, Tooltip, Modal, Tag, Spin,
  Popconfirm, Checkbox, Steps,
} from "antd";
import type { FormInstance } from "antd";
import {
  SaveOutlined, SettingOutlined, QuestionCircleOutlined,
  PlusOutlined, DeleteOutlined, EditOutlined,
} from "@ant-design/icons";
import ConnectionModelFields from "@/components/ConnectionModelFields";
import RoleModelField from "@/components/RoleModelField";
import AppHeader from "@/components/AppHeader";
import { useUnsavedForm } from "@/hooks/useUnsavedForm";
import { useAuth } from "@/context/AuthContext";
import { useNavigation } from "@/context/NavigationContext";
import { backDestinationKey } from "@/utils/backDestination";
import "@/styles/workspace-polish.css";
import "@/styles/ai-settings.css";
import { useI18n } from "@/i18n";
import {
  fetchLlmProviders,
  apiErrorMessage,
  isDesktopApp,
  createCustomLLM,
  updateCustomLLM,
  deleteCustomLLM,
} from "@/api/client";
import type { LlmProvidersResponse, CustomLlmInfo } from "@/types";

import { llmSelection, llmProviderSelection } from "@/utils/llmSelection";

const { Content } = Layout;
const { Title } = Typography;
const { Option } = Select;
const { Password } = Input;

type AgentMode = "flexible" | "react" | "direct";
type ClaudeAuthMode = "auto" | "api_key" | "auth_token";
type AiPreferences = {
  agent_mode: AgentMode;
  max_llm_iterations: number;
  max_tokens_per_task: number;
  enable_auto_audit: boolean;
  preview_before_save: boolean;
  auto_audit_min_score: number;
  ai_language: string | null;
};
const emptyPreferences: AiPreferences = {
  agent_mode: "flexible", max_llm_iterations: 10, max_tokens_per_task: 50000,
  enable_auto_audit: true, preview_before_save: true, auto_audit_min_score: 60, ai_language: "follow",
};

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
          tooltip={t("ai_settings_claude_auth_mode_hint")}
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

function ModelRoleSection({ target, providerValue, model, models, options, busy, pending, feedback, revision, onProviderChange, onModelChange, onAdd }: {
  target: "generation" | "agent"; providerValue: string; model: string; models: string[];
  options: { value: string; label: string }[]; busy: boolean; pending: boolean; feedback: string; revision: string;
  onProviderChange: (value: string) => Promise<void>; onModelChange: (value: string) => Promise<void>; onAdd: () => void;
}) {
  const { t } = useI18n();
  const title = t(target === "generation" ? "ai_settings_generation_ai" : "ai_settings_agent_ai");
  return <div className="ai-model-role">
    <div className="ai-model-role__heading">
      <h2>{title}</h2>
      <span role="status" className={feedback === "ai_settings_save_failed" ? "ai-feedback is-error" : "ai-feedback"}>
        {pending ? t("form_saving") : feedback ? t(feedback) : ""}
      </span>
    </div>
    {options.length ? <div className="ai-model-fields">
      <Form.Item label={t("ai_settings_provider")} htmlFor={`ai-${target}-provider`}>
        <Select id={`ai-${target}-provider`} size="large" showSearch optionFilterProp="label"
          value={providerValue || undefined} placeholder={t("ai_settings_provider_placeholder")}
          options={options} onChange={(value) => void onProviderChange(value)} disabled={busy} />
      </Form.Item>
      <Form.Item label={t("ai_settings_model")} htmlFor={`ai-${target}-model`}>
        <RoleModelField key={revision} target={target} inputId={`ai-${target}-model`} value={model} models={models}
          disabled={busy || !providerValue} onSave={onModelChange} />
      </Form.Item>
    </div> : <div className="ai-role-empty">
      <p>{t("settings_agent_connection_hint")}</p>
      <Button onClick={onAdd} icon={<PlusOutlined />}>{t("ai_add_assistant_connection")}</Button>
    </div>}
  </div>;
}

export default function AiSettings() {
  const { user, updateAiSettings, refreshUser } = useAuth();
  const { t } = useI18n();
  const { message } = AntApp.useApp();
  const { goBackSmart, lastValidPage } = useNavigation();
  const [form] = Form.useForm<AiPreferences>();
  const [settingsSection, setSettingsSection] = useState("connections");
  const autoAuditEnabled = Form.useWatch("enable_auto_audit", form);
  const agentModeValue = Form.useWatch("agent_mode", form) as AgentMode | undefined;
  const [errorMsg, setErrorMsg] = useState("");

  const [providerInfo, setProviderInfo] = useState<LlmProvidersResponse | null>(null);
  const [providerLoading, setProviderLoading] = useState(true);
  const [providerError, setProviderError] = useState("");

  const [genProviderValue, setGenProviderValue] = useState<string>("");
  const [genModel, setGenModel] = useState<string>("");
  const [genSaving, setGenSaving] = useState(false);

  const [agentProviderValue, setAgentProviderValue] = useState<string>("");
  const [agentModel, setAgentModel] = useState<string>("");
  const [agentSaving, setAgentSaving] = useState(false);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addStep, setAddStep] = useState(0);
  const [addingForAgent, setAddingForAgent] = useState(false);
  const [newConnection, setNewConnection] = useState<CustomLlmInfo | null>(null);
  const [assignGeneration, setAssignGeneration] = useState(true);
  const [assignAgent, setAssignAgent] = useState(false);
  const [assignSaving, setAssignSaving] = useState(false);
  const [assignError, setAssignError] = useState("");
  const [genFeedback, setGenFeedback] = useState("");
  const [agentFeedback, setAgentFeedback] = useState("");
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingCustom, setEditingCustom] = useState<CustomLlmInfo | null>(null);
  const [addForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [addSaving, setAddSaving] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  const { dirty: preferencesDirty, saving, initialize, refreshDirty, save, leaveDialog } = useUnsavedForm({
    form, emptyValues: emptyPreferences,
    async onSave(values) {
      setErrorMsg("");
      try {
        await updateAiSettings({ ...values, ai_language: values.ai_language === "follow" ? null : values.ai_language });
        message.success(t("ai_settings_save_success"));
      } catch (error) {
        setErrorMsg(apiErrorMessage(error));
        throw error;
      }
    },
  });

  const loadProviderInfo = useCallback(async () => {
    setProviderLoading(true); setProviderError("");
    try {
      const data = await fetchLlmProviders();
      setProviderInfo(isDesktopApp ? { ...data, builtin: [], agent_builtin: null, default: "" } : data);
      return data;
    } catch (error) {
      setProviderError(apiErrorMessage(error));
      return null;
    } finally { setProviderLoading(false); }
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
    initialize({
      agent_mode: (user.agent_mode || "flexible") as AgentMode,
      max_llm_iterations: user.max_llm_iterations || 10,
      max_tokens_per_task: user.max_tokens_per_task || 50000,
      enable_auto_audit: user.enable_auto_audit ?? true,
      preview_before_save: user.preview_before_save ?? true,
      auto_audit_min_score: user.auto_audit_min_score ?? 60,
      ai_language: user.ai_language || "follow",
    });
  // Switching a model must not discard edits in another settings section.
  }, [user?.id, user?.agent_mode, user?.max_llm_iterations, user?.max_tokens_per_task,
    user?.enable_auto_audit, user?.preview_before_save, user?.auto_audit_min_score, user?.ai_language, initialize]);

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
      setGenSaving(true); setGenFeedback("");
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
        setGenFeedback("form_saved");
        message.success(t("ai_settings_switch_success"));
      } catch (e) {
        setGenFeedback("ai_settings_save_failed");
        message.error(apiErrorMessage(e));
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
      setAgentSaving(true); setAgentFeedback("");
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
        setAgentFeedback("form_saved");
        message.success(t("ai_settings_switch_success"));
      } catch (e) {
        setAgentFeedback("ai_settings_save_failed");
        message.error(apiErrorMessage(e));
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

  const handleAddCustomLlm = async () => {
    let values;
    try { values = await addForm.validateFields(); } catch { return; }
    setAddSaving(true);
    try {
      const created = await createCustomLLM({
        provider: values.provider,
        protocol: values.protocol,
        claude_auth_mode: values.claude_auth_mode,
        default_model: values.default_model.trim(),
        api_key: values.api_key.trim(),
        base_url: values.base_url?.trim() || null,
      });
      setAddModalOpen(false);
      setNewConnection(created);
      setAssignGeneration(!addingForAgent || created.protocol !== "anthropic");
      setAssignAgent(addingForAgent && created.protocol === "anthropic");
      setAssignError("");
      addForm.resetFields();
      const newData = await loadProviderInfo();
      if (newData) {
        await refreshUser();
      }
      message.success(t("ai_settings_custom_added"));
    } catch (e) {
      message.error(apiErrorMessage(e));
    } finally {
      setAddSaving(false);
    }
  };

  const assignConnection = async () => {
    if (!newConnection) return;
    setAssignSaving(true); setAssignError("");
    try {
      await updateAiSettings({
        ...(assignGeneration ? { generation_use_custom: true, generation_custom_llm_id: newConnection.id, preferred_llm_model: newConnection.default_model } : {}),
        ...(assignAgent ? { agent_use_custom: true, agent_custom_llm_id: newConnection.id, agent_model: newConnection.default_model } : {}),
      });
      setNewConnection(null);
      setGenFeedback(assignGeneration ? "form_saved" : ""); setAgentFeedback(assignAgent ? "form_saved" : "");
    } catch (error) { setAssignError(apiErrorMessage(error)); }
    finally { setAssignSaving(false); }
  };

  const handleEditCustomLlm = async () => {
    if (!editingCustom) return;
    let values;
    try { values = await editForm.validateFields(); } catch { return; }
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
      message.error(apiErrorMessage(e));
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
      message.error(apiErrorMessage(e));
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

  const openAddModal = (provider = "openai") => {
    const selected = ALL_PROVIDERS.find((item) => item.value === provider) || ALL_PROVIDERS[0];
    setAddStep(0);
    setAddingForAgent(provider === "anthropic");
    addForm.setFieldsValue({
      provider: selected.value,
      protocol: selected.value === "anthropic" ? "anthropic" : "openai",
      claude_auth_mode: "auto",
      default_model: "",
      api_key: "",
      base_url: selected.defaultUrl,
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

  const genCurrentModels = genProviderValue ? getModelsForProviderValue(genProviderValue) : [];

  const agentCurrentModels = agentProviderValue ? getModelsForProviderValue(agentProviderValue) : [];

  const agentCurrentModel = agentProviderValue ? agentModel : "";
  const generationAvailable = Boolean(providerInfo && (providerInfo.builtin.length || providerInfo.custom_llms.length));
  const agentAvailable = Boolean(providerInfo && (providerInfo.agent_builtin || providerInfo.custom_llms.some((connection) => connection.protocol === "anthropic")));

  const customOptions = (providerInfo?.custom_llms || []).map((connection) => ({
    value: `custom:${connection.id}`,
    label: `${connection.provider_label} · ${connection.default_model || connection.id}`,
  }));
  const generationOptions = [
    ...(providerInfo?.builtin || []).map((provider) => ({ value: `builtin:${provider.id}`, label: `${provider.label} · ${t("ai_settings_builtin_tag")}` })),
    ...customOptions,
  ];
  const agentOptions = [
    ...(providerInfo?.agent_builtin ? [{ value: "builtin:anthropic", label: t("ai_settings_agent_builtin_proxy") }] : []),
    ...customOptions.filter((option) => providerInfo?.custom_llms.find((connection) => `custom:${connection.id}` === option.value)?.protocol === "anthropic"),
  ];

  return (
    <Layout className="settings-page ai-settings-page">
      <AppHeader back={{ label: t(backDestinationKey(lastValidPage)), onClick: goBackSmart }}
        leftContent={<div className="ai-settings-title"><SettingOutlined /><Title level={3}>{t("ai_settings_title")}</Title></div>}
        disabledMenuItem="settings" />
      <Content>
        {leaveDialog}
        <div className="settings-section-nav" role="group" aria-label={t("settings_sections")}>
          {(["connections", "preferences", "advanced"] as const).map((key) => <button type="button" key={key}
            aria-pressed={settingsSection === key} onClick={() => setSettingsSection(key)}>{t(`settings_section_${key}`)}</button>)}
        </div>
        <Form form={form} name="aiSettings" onFinish={() => void save()} layout="vertical" disabled={saving}
          className="ai-settings-surface" onValuesChange={() => { refreshDirty(); setErrorMsg(""); }} onFinishFailed={({ errorFields }) => {
            const name = String(errorFields[0]?.name[0] || "");
            setSettingsSection(["agent_mode", "max_llm_iterations", "max_tokens_per_task"].includes(name) ? "advanced" : "preferences");
          }}>
          {errorMsg && <Alert title={t("ai_settings_save_failed")} description={errorMsg} type="error" showIcon />}
          <section hidden={settingsSection !== "connections"} aria-label={t("settings_section_connections")}>
            {providerLoading && !providerInfo && <div className="ai-settings-loading" role="status"><Spin /><span>{t("ai_connections_loading")}</span></div>}
            {providerError && <Alert type="error" showIcon title={t("ai_connections_load_failed")} description={providerError}
              action={<Button loading={providerLoading} onClick={() => void loadProviderInfo()}>{t("ai_connections_retry")}</Button>} />}
            {providerInfo && !generationAvailable && !agentAvailable && <div className="ai-setup-empty">
              <h2>{t("settings_setup_title")}</h2><p>{t("settings_setup_hint")}</p>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => openAddModal()}>{t("settings_add_connection")}</Button>
            </div>}
            {(generationAvailable || agentAvailable) && <>
              <div className="ai-section-toolbar"><p>{t("settings_models_autosave")}</p></div>
              <ModelRoleSection target="generation" providerValue={genProviderValue} model={genModel} models={genCurrentModels}
                options={generationOptions} busy={genSaving || agentSaving || saving} pending={genSaving} feedback={genFeedback}
                revision={JSON.stringify([genProviderValue, providerInfo])} onProviderChange={handleGenProviderChange}
                onModelChange={handleGenModelChange} onAdd={() => openAddModal()} />
              <ModelRoleSection target="agent" providerValue={agentProviderValue} model={agentCurrentModel} models={agentCurrentModels}
                options={agentOptions} busy={agentSaving || genSaving || saving} pending={agentSaving} feedback={agentFeedback}
                revision={JSON.stringify([agentProviderValue, providerInfo])} onProviderChange={handleAgentProviderChange}
                onModelChange={handleAgentModelChange} onAdd={() => openAddModal("anthropic")} />
              <div className="ai-connection-library">
                <div className="ai-section-toolbar"><h2>{t("ai_connections_heading")}</h2>
                  <Button icon={<PlusOutlined />} onClick={() => openAddModal()}>{t("settings_add_connection")}</Button>
                </div>
                {!providerInfo?.custom_llms.length && <p className="ai-library-empty">{t("ai_settings_no_custom_llms")}</p>}
                <ul className="ai-connection-list">
                  {providerInfo?.custom_llms.map((connection) => <li key={connection.id}>
                    <div className="ai-connection-row">
                      <div className="ai-connection-identity"><strong>{connection.provider_label}</strong>
                        <span className="ai-protocol-label">{connection.protocol === "anthropic" ? "Anthropic" : "OpenAI"}</span>
                        {user?.generation_use_custom && user.generation_custom_llm_id === connection.id && <Tag>{t("ai_settings_generation_ai")}</Tag>}
                        {user?.agent_use_custom && user.agent_custom_llm_id === connection.id && <Tag>{t("ai_settings_agent_ai")}</Tag>}
                        <span className="ai-connection-model">{connection.default_model}</span>
                      </div>
                      <div className="ai-connection-actions"><Button type="text" icon={<EditOutlined />} onClick={() => openEditModal(connection)}>{t("ai_settings_edit_custom")}</Button>
                        <Popconfirm title={t("ai_settings_delete_custom_confirm")} onConfirm={() => handleDeleteCustomLlm(connection.id)}
                          okText={t("ai_settings_confirm_delete")} cancelText={t("ai_settings_cancel")}>
                          <Button type="text" icon={<DeleteOutlined />} danger>{t("ai_settings_remove_custom")}</Button>
                        </Popconfirm>
                      </div>
                    </div>
                    <details className="ai-connection-details"><summary>{t("llm_details")}</summary>
                      <dl><div><dt>{t("ai_settings_base_url")}</dt><dd>{connection.base_url || "—"}</dd></div>
                        <div><dt>{t("ai_settings_api_key")}</dt><dd>{connection.api_key || "—"}</dd></div>
                        <div><dt>{t("ai_settings_available_models")}</dt><dd>{connection.models.join(", ") || "—"}</dd></div></dl>
                    </details>
                  </li>)}
                </ul>
              </div>
            </>}
          </section>
          <section hidden={settingsSection !== "preferences"} aria-label={t("settings_section_preferences")}>
            <div className="ai-setting-row">
              <div><label htmlFor="aiSettings_preview_before_save">{t("ai_settings_preview_confirm")}</label><p>{t("ai_preview_hint_short")}</p></div>
              <Form.Item name="preview_before_save" valuePropName="checked" noStyle><Switch id="aiSettings_preview_before_save" aria-label={t("ai_settings_preview_confirm")} /></Form.Item>
            </div>
            <div className="ai-setting-row">
              <div><label htmlFor="aiSettings_enable_auto_audit">{t("ai_settings_auto_audit")}</label><p>{t("ai_audit_hint_short")}</p></div>
              <Form.Item name="enable_auto_audit" valuePropName="checked" noStyle><Switch id="aiSettings_enable_auto_audit" aria-label={t("ai_settings_auto_audit")} /></Form.Item>
            </div>
            <div className="ai-setting-row">
              <label htmlFor="aiSettings_auto_audit_min_score">{t("ai_settings_auto_audit_min_score")}</label>
              <Form.Item name="auto_audit_min_score" className="ai-setting-control" rules={[{ required: true, type: "number", min: 0, max: 100 }]}>
                <InputNumber min={0} max={100} size="large" suffix={t("common_points")} disabled={saving || !autoAuditEnabled} />
              </Form.Item>
            </div>
            <div className="ai-setting-row">
              <label htmlFor="aiSettings_ai_language">{t("ai_settings_ai_language")}</label>
              <Form.Item name="ai_language" className="ai-setting-control">
                <Select size="large" virtual={false} options={[{ value: "follow", label: t("ai_settings_ai_language_follow_ui") }, { value: "zh", label: "中文" }, { value: "en", label: "English" }]} />
              </Form.Item>
            </div>
          </section>
          <section hidden={settingsSection !== "advanced"} aria-label={t("settings_section_advanced")}>
            <Form.Item name="agent_mode" label={t("ai_settings_agent_mode")} extra={getAgentModeDescription(agentModeValue || "flexible")}
              tooltip={t("ai_settings_mode_note")}>
              <Select size="large" virtual={false} options={(["flexible", "react", "direct"] as AgentMode[]).map((mode) => ({ value: mode, label: getAgentModeLabel(mode) }))} />
            </Form.Item>
            <div className="ai-resource-settings"><h2>{t("ai_settings_resource_limit")}</h2>
              <div className="ai-model-fields">
                <Form.Item name="max_llm_iterations" label={t("ai_settings_max_iterations")} rules={[{ required: true, type: "number", min: 1, max: 50 }]}>
                  <InputNumber min={1} max={50} size="large" suffix={t("common_rounds")} />
                </Form.Item>
                <Form.Item name="max_tokens_per_task" label={t("ai_settings_max_tokens")} rules={[{ required: true, type: "number", min: 1000, max: 500000 }]}>
                  <InputNumber min={1000} max={500000} size="large" suffix="Token" step={1000} />
                </Form.Item>
              </div>
            </div>
          </section>
          {(settingsSection !== "connections" || preferencesDirty) && <footer className="ai-settings-footer">
            <p role="status" className={preferencesDirty ? "is-dirty" : ""}>{t(saving ? "form_saving" : preferencesDirty ? "settings_preferences_unsaved" : "form_saved")}</p>
            <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving} disabled={!preferencesDirty}>{t("ai_settings_save_button")}</Button>
          </footer>}
        </Form>
      </Content>

      {/* Add Custom LLM Modal */}
      <Modal
        title={t("ai_settings_add_custom_llm_title")}
        open={addModalOpen}
        onOk={async () => {
          if (addStep === 0) {
            try { await addForm.validateFields(["provider", "protocol", "api_key", "base_url", "claude_auth_mode"]); setAddStep(1); } catch { /* Show field validation. */ }
          } else { await handleAddCustomLlm(); }
        }}
        onCancel={() => !addSaving && setAddModalOpen(false)}
        closable={!addSaving} mask={{ closable: !addSaving }} keyboard={!addSaving} cancelButtonProps={{ disabled: addSaving }}
        okText={t(addStep === 0 ? "settings_next_test" : "settings_save_assign")}
        confirmLoading={addSaving}
        destroyOnHidden
        width={520}
        style={{ top: 24 }}
        styles={{ body: { maxHeight: "calc(100dvh - 180px)", overflowY: "auto", paddingRight: 8 } }}
      >
        <Steps size="small" current={addStep} items={[{ title: t("settings_step_connect") }, { title: t("settings_step_test") }, { title: t("settings_step_assign") }]} />
        <Form form={addForm} disabled={addSaving} layout="vertical" className="connection-setup-form">
          <div hidden={addStep !== 0}>
          <p className="workspace-hint">{t("settings_connection_example")}</p>
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
            tooltip={t("ai_settings_protocol_hint")}
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
          </div>
          <div hidden={addStep !== 1}>
            <p className="workspace-hint">{t("settings_test_hint")}</p>
            <ConnectionModelFields form={addForm} />
            <Button type="text" onClick={() => setAddStep(0)}>{t("settings_edit_connection")}</Button>
          </div>
        </Form>
      </Modal>

      <Modal title={t("settings_assign_title")} open={Boolean(newConnection)} onCancel={() => !assignSaving && setNewConnection(null)}
        onOk={() => void assignConnection()} okText={t("settings_apply_roles")} cancelText={t("settings_assign_later")}
        confirmLoading={assignSaving} okButtonProps={{ disabled: !assignGeneration && !assignAgent }}>
        <Steps size="small" current={2} items={[{ title: t("settings_step_connect") }, { title: t("settings_step_test") }, { title: t("settings_step_assign") }]} />
        <p>{newConnection?.provider_label} · {newConnection?.default_model}</p>
        <p className="workspace-hint">{t("settings_assign_hint")}</p>
        <div className="settings-assignment-options">
          <Checkbox checked={assignGeneration} disabled={assignSaving} onChange={(e) => setAssignGeneration(e.target.checked)}>{t("ai_settings_generation_ai")}</Checkbox>
          <Checkbox checked={assignAgent} disabled={assignSaving || newConnection?.protocol !== "anthropic"} onChange={(e) => setAssignAgent(e.target.checked)}>{t("ai_settings_agent_ai")}</Checkbox>
        </div>
        {newConnection?.protocol !== "anthropic" && <p className="workspace-hint">{t("settings_agent_protocol_hint")}</p>}
        {assignError && <Alert type="error" showIcon title={assignError} />}
      </Modal>

      {/* Edit Custom LLM Modal */}
      <Modal
        title={t("ai_settings_edit_custom_llm_title")}
        open={editModalOpen}
        onOk={handleEditCustomLlm}
        onCancel={() => {
          if (editSaving) return;
          setEditModalOpen(false);
          setEditingCustom(null);
        }}
        okText={t("ai_settings_save_button")}
        confirmLoading={editSaving}
        closable={!editSaving} mask={{ closable: !editSaving }} keyboard={!editSaving} cancelButtonProps={{ disabled: editSaving }}
        destroyOnHidden
        width={520}
        style={{ top: 24 }}
        styles={{ body: { maxHeight: "calc(100dvh - 180px)", overflowY: "auto", paddingRight: 8 } }}
      >
        <Form form={editForm} disabled={editSaving} layout="vertical">
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
            tooltip={t("ai_settings_protocol_hint")}
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
