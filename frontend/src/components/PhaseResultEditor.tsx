import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/i18n";
import type {
  PhaseDisplayResult,
  WorkflowPhaseType,
  WorkflowStatus,
} from "@/types/workflow";

export interface PhaseResultEditorProps {
  result?: PhaseDisplayResult | null;
  phaseType?: WorkflowPhaseType;
  status?: WorkflowStatus;
  onModificationsChange?: (modifications: Record<string, unknown>) => void;
  initialModifications?: Record<string, unknown>;
  disabled?: boolean;
  className?: string;
}

function getFieldLabel(field: string, t: (key: string) => string): string {
  const labels: Record<string, string> = {
    background: t("workflow_field_background"),
    core_settings: t("workflow_field_core_settings"),
    writing_style: t("workflow_field_writing_style"),
    chapters: t("workflow_field_chapters"),
    major_plotlines: t("workflow_field_major_plotlines"),
    characters: t("workflow_field_characters"),
    chapter_summary: t("workflow_field_summary"),
    title: t("workflow_field_title"),
    key_events: t("workflow_field_key_events"),
    character_arcs: t("workflow_field_character_arcs"),
    body: t("workflow_field_body"),
    original_content: t("workflow_field_original"),
    polished_content: t("workflow_field_polished"),
    polish_mode: t("workflow_field_polish_mode"),
    instructions: t("workflow_field_instructions"),
  };
  return labels[field] || field;
}

function isLargeTextField(field: string): boolean {
  return [
    "background",
    "core_settings",
    "writing_style",
    "major_plotlines",
    "chapter_summary",
    "body",
    "original_content",
    "polished_content",
    "instructions",
  ].includes(field);
}

function isArrayField(field: string): boolean {
  return ["chapters", "key_events", "characters"].includes(field);
}

function formatArrayValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === "string") return item;
      if (typeof item === "object" && item !== null) {
        return JSON.stringify(item, null, 2);
      }
      return String(item);
    }).join("\n\n---\n\n");
  }
  return "";
}

export default function PhaseResultEditor({
  result,
  phaseType: _phaseType,
  status,
  onModificationsChange,
  initialModifications = {},
  disabled = false,
  className = "",
}: PhaseResultEditorProps) {
  const { t } = useI18n();
  const [modifications, setModifications] = useState<Record<string, unknown>>(initialModifications);

  useEffect(() => {
    setModifications(initialModifications);
  }, [initialModifications]);

  const handleFieldChange = useCallback(
    (field: string, value: unknown) => {
      const newModifications = {
        ...modifications,
        [field]: value,
      };
      setModifications(newModifications);
      onModificationsChange?.(newModifications);
    },
    [modifications, onModificationsChange]
  );

  const getEffectiveValue = useCallback(
    (field: string): unknown => {
      if (field in modifications) {
        return modifications[field];
      }
      if (result?.display_content && field in result.display_content) {
        return result.display_content[field];
      }
      return undefined;
    },
    [modifications, result]
  );

  const isFieldModified = useCallback(
    (field: string): boolean => {
      return field in modifications;
    },
    [modifications]
  );

  if (!result) {
    return (
      <div className={`phase-result-editor-empty ${className}`}>
        <p className="muted">{t("workflow_no_result")}</p>
      </div>
    );
  }

  if (!result.success) {
    return (
      <div className={`phase-result-editor error ${className}`}>
        <div className="phase-error">
          <span className="error-icon">❌</span>
          <div className="error-content">
            <strong>{t("workflow_generation_failed")}</strong>
            <p className="error-message">{result.error_message || t("workflow_unknown_error")}</p>
          </div>
        </div>
      </div>
    );
  }

  const editableFields = result.editable_fields || [];
  const hasEditableFields = editableFields.length > 0;

  const renderField = (field: string) => {
    const value = getEffectiveValue(field);
    const modified = isFieldModified(field);
    const label = getFieldLabel(field, t);
    const isLarge = isLargeTextField(field);
    const isArray = isArrayField(field);
    const isDisabled = disabled;

    if (value === undefined || value === null) {
      return null;
    }

    if (isArray) {
      const stringValue =
        typeof value === "string" ? value : formatArrayValue(value);
      return (
        <div key={field} className={`phase-field ${modified ? "is-modified" : ""}`}>
          <label className="phase-field-label">
            {label}
            {modified && <span className="modified-badge">{t("workflow_modified")}</span>}
          </label>
          <textarea
            className="phase-field-input phase-field-textarea large"
            value={stringValue}
            onChange={(e) => handleFieldChange(field, e.target.value)}
            disabled={isDisabled}
            rows={10}
          />
        </div>
      );
    }

    if (isLarge) {
      return (
        <div key={field} className={`phase-field ${modified ? "is-modified" : ""}`}>
          <label className="phase-field-label">
            {label}
            {modified && <span className="modified-badge">{t("workflow_modified")}</span>}
          </label>
          <textarea
            className="phase-field-input phase-field-textarea"
            value={String(value)}
            onChange={(e) => handleFieldChange(field, e.target.value)}
            disabled={isDisabled}
            rows={field === "body" ? 15 : 6}
          />
        </div>
      );
    }

    return (
      <div key={field} className={`phase-field ${modified ? "is-modified" : ""}`}>
        <label className="phase-field-label">
          {label}
          {modified && <span className="modified-badge">{t("workflow_modified")}</span>}
        </label>
        <input
          type="text"
          className="phase-field-input phase-field-text"
          value={String(value)}
          onChange={(e) => handleFieldChange(field, e.target.value)}
          disabled={isDisabled}
        />
      </div>
    );
  };

  return (
    <div className={`phase-result-editor ${className}`}>
      <div className="phase-result-header">
        <strong>{t("workflow_phase_result")}</strong>
        {status === "waiting_user_confirm" && (
          <span className="phase-status-badge waiting">{t("workflow_waiting_confirm")}</span>
        )}
      </div>

      {hasEditableFields ? (
        <div className="phase-fields">{editableFields.map(renderField)}</div>
      ) : (
        <div className="phase-fields-preview">
          {Object.entries(result.display_content).map(([key, value]) => {
            if (value === undefined || value === null) return null;
            const label = getFieldLabel(key, t);
            const isLarge = isLargeTextField(key);

            return (
              <div key={key} className="phase-field-preview">
                <span className="phase-field-preview-label">{label}</span>
                {isLarge ? (
                  <pre className="phase-field-preview-value large">
                    {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
                  </pre>
                ) : (
                  <span className="phase-field-preview-value">
                    {typeof value === "string" ? value : JSON.stringify(value)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {result.suggestions && result.suggestions.length > 0 && (
        <div className="phase-suggestions">
          <strong className="phase-suggestions-title">{t("workflow_ai_suggestions")}</strong>
          <ul className="phase-suggestions-list">
            {result.suggestions.map((suggestion, index) => (
              <li key={index} className="phase-suggestion-item">
                <span className="suggestion-icon">💡</span>
                <span>{suggestion}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
