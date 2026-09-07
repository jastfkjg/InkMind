import { useEffect, useState } from "react";
import { Form, AutoComplete, type FormInstance } from "antd";
import { useI18n } from "@/i18n";
import { probeDraftLlm } from "@/api/client";
import LlmProbeControls from "./LlmProbeControls";

export default function ConnectionModelFields({ form, customId }: { form: FormInstance; customId?: number }) {
  const { t } = useI18n();
  const values = Form.useWatch([], form);
  const [models, setModels] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const connectionKey = JSON.stringify([customId, values?.provider, values?.protocol, values?.base_url, values?.api_key]);
  useEffect(() => { setModels([]); }, [connectionKey]);
  return <>
    <Form.Item name="default_model" label={t("llm_default_model")}
      extra={t("llm_default_model_hint")}
      rules={[{ required: true, whitespace: true, message: t("llm_default_model_required") }, { max: 256 }]}>
      <AutoComplete size="large" placeholder={t("llm_compact_placeholder")} options={models.map(value => ({ value }))}
        onFocus={() => setSearching(false)} onSearch={() => setSearching(true)}
        filterOption={(input, option) => !searching || String(option?.value).toLowerCase().includes(input.toLowerCase())} />
    </Form.Item>
    <LlmProbeControls revision={JSON.stringify([customId, values])}
      onModels={setModels}
      run={async (mode) => {
        const fields = ["provider", "protocol", "base_url", "api_key", ...(mode === "model" ? ["default_model"] : [])];
        try { await form.validateFields(fields); } catch { return {mode, status:"unconfigured", models:[], http_status:null}; }
        const current = form.getFieldsValue();
        return probeDraftLlm({ ...current, api_key: current.api_key?.includes("***") ? undefined : current.api_key,
          custom_llm_id: customId, mode });
      }} />
  </>;
}
