import { useEffect, useState } from "react";
import { AutoComplete, Button, Space } from "antd";
import { useI18n } from "@/i18n";

type Props = {
  value: string;
  models: string[];
  disabled?: boolean;
  onSave: (model: string) => Promise<void>;
};

/** Presets are suggestions; arbitrary model IDs are committed explicitly. */
export default function ModelInput({ value, models, disabled, onSave }: Props) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  useEffect(() => setDraft(value), [value]);
  const suggestions = [...new Set([value, ...models].filter(Boolean))];
  const hasMatches = suggestions.some((model) => model.toLowerCase().includes(draft.toLowerCase()));
  const save = async (model = draft) => {
    const trimmed = model.trim();
    if (!trimmed || trimmed === value || disabled) return;
    await onSave(trimmed);
  };
  return (
    <Space.Compact style={{ width: "100%" }}>
      <AutoComplete
        size="large"
        style={{ flex: 1, minWidth: 0 }}
        aria-label={t("ai_settings_model")}
        value={draft}
        options={suggestions.map((model) => ({ value: model }))}
        filterOption={(input, option) => String(option?.value).toLowerCase().includes(input.toLowerCase())}
        placeholder={t("ai_settings_model_custom_hint")}
        disabled={disabled}
        onOpenChange={setOpen}
        onChange={setDraft}
        onSelect={(model) => { void save(model); }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (!open || !hasMatches) && !event.nativeEvent.isComposing) void save();
        }}
      />
      <Button size="large" disabled={disabled || !draft.trim() || draft.trim() === value} onClick={() => void save()}>
        {t("ai_settings_save_button")}
      </Button>
    </Space.Compact>
  );
}
