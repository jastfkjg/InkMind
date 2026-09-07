import { useEffect, useState } from "react";
import { AutoComplete, Button, Space } from "antd";
import { useI18n } from "@/i18n";

type Props = {
  value: string;
  models: string[];
  disabled?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onSave: (model: string) => Promise<void>;
};

/** Presets are suggestions; arbitrary model IDs are committed explicitly. */
export default function ModelInput({ value, models, disabled, onSave, onDirtyChange }: Props) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  useEffect(() => { onDirtyChange?.(draft.trim() !== value); }, [draft, value, onDirtyChange]);
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
        filterOption={(input, option) => !searching || String(option?.value).toLowerCase().includes(input.toLowerCase())}
        placeholder={t("llm_compact_placeholder")}
        disabled={disabled}
        onOpenChange={(next) => { setOpen(next); if (!next) setSearching(false); }}
        onFocus={() => setSearching(false)}
        onSearch={() => setSearching(true)}
        onChange={setDraft}
        onSelect={(model) => { void save(model); }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (!open || !hasMatches) && !event.nativeEvent.isComposing) void save();
        }}
      />
      {draft.trim() !== value && <Button size="large" disabled={disabled || !draft.trim() || draft.trim() === value} onClick={() => void save()}>
        {t("ai_settings_save_button")}
      </Button>}
    </Space.Compact>
  );
}
