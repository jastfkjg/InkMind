import { useCallback, useEffect, useState, useRef } from "react";
import { useI18n } from "@/i18n";
import {
  type WorkflowProgress,
  type WorkflowPhaseType,
  type CreateWorkflowRequest,
  PHASE_NAMES,
  CHAPTER_PHASES,
  isPhaseActive,
  isPhaseCompleted,
  canExecutePhase,
  canConfirmPhase,
  canSaveChapter,
} from "@/types/workflow";
import {
  createWorkflow,
  executePhase,
  confirmPhase,
  saveWorkflowChapter,
  fetchWorkflowProgress,
} from "@/api/client";
import { message, Modal } from "antd";
import type { Chapter } from "@/types";

export interface WorkflowPanelProps {
  novelId: number;
  activeChapterId?: number | null;
  onChapterSaved?: (chapter: Partial<Chapter> & { id: number; title: string }) => void;
  onWorkflowStateChange?: (workflowId: string | null, progress: WorkflowProgress | null) => void;
}

const WORKFLOW_ID_KEY = "inkmind_workflow_id";

function getStoredWorkflowId(novelId: number): string | null {
  try {
    const key = `${WORKFLOW_ID_KEY}_${novelId}`;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setStoredWorkflowId(novelId: number, workflowId: string | null): void {
  try {
    const key = `${WORKFLOW_ID_KEY}_${novelId}`;
    if (workflowId) {
      localStorage.setItem(key, workflowId);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

export default function WorkflowPanel({
  novelId,
  activeChapterId: _activeChapterId,
  onChapterSaved,
  onWorkflowStateChange,
}: WorkflowPanelProps) {
  const { t } = useI18n();

  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [progress, setProgress] = useState<WorkflowProgress | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    chapterSummary: "",
    fixedTitle: "",
    wordCount: null as number | null,
  });

  const [modifications, setModifications] = useState<Record<string, unknown>>({});

  const loadProgressRef = useRef(false);

  const loadWorkflowProgress = useCallback(async (wId: string) => {
    try {
      const result = await fetchWorkflowProgress(novelId, wId);
      setProgress(result);
      onWorkflowStateChange?.(wId, result);
    } catch (error) {
      console.error("Failed to load workflow progress:", error);
    }
  }, [novelId, onWorkflowStateChange]);

  useEffect(() => {
    const storedId = getStoredWorkflowId(novelId);
    if (storedId && !loadProgressRef.current) {
      loadProgressRef.current = true;
      setWorkflowId(storedId);
      loadWorkflowProgress(storedId);
    }
  }, [novelId, loadWorkflowProgress]);

  const handleCreateWorkflow = useCallback(async () => {
    setIsCreating(true);
    try {
      const payload: CreateWorkflowRequest = {
        initial_phase: "chapter_summary",
      };

      if (createForm.chapterSummary.trim()) {
        payload.chapter_summary = createForm.chapterSummary.trim();
        payload.initial_phase = "chapter_content";
      }
      if (createForm.fixedTitle.trim()) {
        payload.fixed_title = createForm.fixedTitle.trim();
      }
      if (createForm.wordCount) {
        payload.word_count = createForm.wordCount;
      }

      const result = await createWorkflow(novelId, payload);
      setWorkflowId(result.workflow_id);
      setProgress(result.progress);
      setStoredWorkflowId(novelId, result.workflow_id);
      onWorkflowStateChange?.(result.workflow_id, result.progress);
      setShowCreateModal(false);
      setCreateForm({ chapterSummary: "", fixedTitle: "", wordCount: null });
      setModifications({});
      message.success(t("workflow_create_success"));
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      message.error(`${t("workflow_create_failed")}: ${err.message}`);
    } finally {
      setIsCreating(false);
    }
  }, [novelId, createForm, t, onWorkflowStateChange]);

  const handleExecutePhase = useCallback(async () => {
    if (!workflowId) return;

    setIsExecuting(true);
    try {
      const result = await executePhase(novelId, workflowId, {
        user_modifications: Object.keys(modifications).length > 0 ? modifications : undefined,
      });
      setProgress(result.progress);
      onWorkflowStateChange?.(workflowId, result.progress);
      setModifications({});
      message.success(t("workflow_execute_success"));
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      message.error(`${t("workflow_execute_failed")}: ${err.message}`);
    } finally {
      setIsExecuting(false);
    }
  }, [novelId, workflowId, modifications, t, onWorkflowStateChange]);

  const handleConfirmPhase = useCallback(async () => {
    if (!workflowId) return;

    setIsConfirming(true);
    try {
      const result = await confirmPhase(novelId, workflowId, {
        user_modifications: Object.keys(modifications).length > 0 ? modifications : undefined,
      });
      setProgress(result.progress);
      onWorkflowStateChange?.(workflowId, result.progress);
      setModifications({});

      if (result.success) {
        if (result.next_phase) {
          message.success(
            `${t("workflow_confirm_success")} ${t(PHASE_NAMES[result.next_phase].key)}`
          );
        } else {
          message.success(t("workflow_all_phases_complete"));
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      message.error(`${t("workflow_confirm_failed")}: ${err.message}`);
    } finally {
      setIsConfirming(false);
    }
  }, [novelId, workflowId, modifications, t, onWorkflowStateChange]);

  const handleSaveChapter = useCallback(async () => {
    if (!workflowId) return;

    Modal.confirm({
      title: t("workflow_save_confirm_title"),
      content: t("workflow_save_confirm_message"),
      okText: t("common_save"),
      cancelText: t("common_cancel"),
      onOk: async () => {
        setIsSaving(true);
        try {
          const result = await saveWorkflowChapter(novelId, workflowId);
          if (result.success && result.chapter) {
            message.success(t("workflow_save_success"));
            onChapterSaved?.(result.chapter);
            setWorkflowId(null);
            setProgress(null);
            setStoredWorkflowId(novelId, null);
            onWorkflowStateChange?.(null, null);
          } else {
            message.error(result.message || t("workflow_save_failed"));
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          message.error(`${t("workflow_save_failed")}: ${err.message}`);
        } finally {
          setIsSaving(false);
        }
      },
    });
  }, [novelId, workflowId, t, onChapterSaved, onWorkflowStateChange]);

  const handleCancelWorkflow = useCallback(() => {
    Modal.confirm({
      title: t("workflow_cancel_confirm_title"),
      content: t("workflow_cancel_confirm_message"),
      okText: t("common_confirm"),
      cancelText: t("common_cancel"),
      okType: "danger",
      onOk: () => {
        setWorkflowId(null);
        setProgress(null);
        setModifications({});
        setStoredWorkflowId(novelId, null);
        onWorkflowStateChange?.(null, null);
        message.info(t("workflow_cancelled"));
      },
    });
  }, [novelId, t, onWorkflowStateChange]);

  const handleRefreshProgress = useCallback(async () => {
    if (!workflowId) return;
    setIsLoading(true);
    try {
      await loadWorkflowProgress(workflowId);
    } finally {
      setIsLoading(false);
    }
  }, [workflowId, loadWorkflowProgress]);

  const handleModificationChange = useCallback((field: string, value: unknown) => {
    setModifications((prev) => ({
      ...prev,
      [field]: value,
    }));
  }, []);

  const currentPhase = progress?.current_phase;
  const status = progress?.status;
  const hasActiveWorkflow = !!workflowId && !!progress;

  const canExecute = currentPhase && status ? canExecutePhase(currentPhase, currentPhase, status) : false;
  const canConfirm = status ? canConfirmPhase(status) : false;
  const canSave = currentPhase && status ? canSaveChapter(status, currentPhase) : false;

  const getPhaseStatusClass = (phase: WorkflowPhaseType): string => {
    if (!currentPhase || !progress) return "workflow-phase-item--pending";

    const isActive = isPhaseActive(phase, currentPhase, CHAPTER_PHASES);
    const isCompleted = isPhaseCompleted(phase, currentPhase, progress.completed_phases, CHAPTER_PHASES);

    if (isActive) {
      if (status === "running") return "workflow-phase-item--active workflow-phase-item--running";
      if (status === "waiting_user_confirm") return "workflow-phase-item--active workflow-phase-item--waiting";
      if (status === "failed") return "workflow-phase-item--active workflow-phase-item--failed";
      return "workflow-phase-item--active";
    }
    if (isCompleted) return "workflow-phase-item--completed";
    return "workflow-phase-item--pending";
  };

  const getPhaseIcon = (phase: WorkflowPhaseType): string => {
    if (!currentPhase || !progress) return "○";

    const isActive = isPhaseActive(phase, currentPhase, CHAPTER_PHASES);
    const isCompleted = isPhaseCompleted(phase, currentPhase, progress.completed_phases, CHAPTER_PHASES);

    if (isActive) {
      if (status === "running") return "⏳";
      if (status === "waiting_user_confirm") return "⏸️";
      if (status === "failed") return "❌";
      return "⚡";
    }
    if (isCompleted) return "✅";
    return "○";
  };

  const getEffectiveContent = useCallback((field: string): unknown => {
    if (field in modifications) {
      return modifications[field];
    }
    if (progress?.current_result?.display_content) {
      return progress.current_result.display_content[field];
    }
    return undefined;
  }, [modifications, progress]);

  return (
    <div className="workflow-panel">
      <div className="workflow-panel__header">
        <div className="workflow-panel__title-row">
          <span className="workflow-panel__title">{t("workflow_panel_title")}</span>
          {hasActiveWorkflow && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={handleCancelWorkflow}
              title={t("workflow_cancel")}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {!hasActiveWorkflow ? (
        <div className="workflow-panel__empty">
          <div className="workflow-panel__empty-icon">📝</div>
          <p className="workflow-panel__empty-text">{t("workflow_no_active")}</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowCreateModal(true)}
          >
            {t("workflow_start_new")}
          </button>
        </div>
      ) : (
        <div className="workflow-panel__content">
          <div className="workflow-phases-horizontal">
            {CHAPTER_PHASES.map((phase, index) => {
              const isLast = index === CHAPTER_PHASES.length - 1;
              const statusClass = getPhaseStatusClass(phase);
              const icon = getPhaseIcon(phase);

              return (
                <div key={phase} className="workflow-phase-horizontal-wrapper">
                  <div className={`workflow-phase-horizontal-item ${statusClass}`}>
                    <span className="workflow-phase-horizontal__icon">{icon}</span>
                    <span className="workflow-phase-horizontal__label">{t(PHASE_NAMES[phase].key)}</span>
                  </div>
                  {!isLast && <div className="workflow-phase-horizontal__connector"></div>}
                </div>
              );
            })}
          </div>

          {status && (
            <div className="workflow-status-badge-container">
              <span className={`workflow-status-badge workflow-status-badge--${status}`}>
                {status === "running" && <span className="workflow-status-badge__dot workflow-status-badge__dot--running"></span>}
                {status === "waiting_user_confirm" && <span className="workflow-status-badge__dot workflow-status-badge__dot--waiting"></span>}
                {status === "completed" && <span className="workflow-status-badge__dot workflow-status-badge__dot--completed"></span>}
                {status === "failed" && <span className="workflow-status-badge__dot workflow-status-badge__dot--failed"></span>}
                {t(`workflow_status_${status}`)}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm workflow-refresh-btn"
                onClick={handleRefreshProgress}
                disabled={isLoading}
              >
                {isLoading ? "..." : "↻"}
              </button>
            </div>
          )}

          {progress?.current_result && progress.current_result.success && (
            <div className="workflow-result-section">
              <div className="workflow-result-section__header">
                <span className="workflow-result-section__title">{t("workflow_phase_result")}</span>
                {status === "waiting_user_confirm" && (
                  <span className="workflow-result-section__badge">{t("workflow_waiting_confirm")}</span>
                )}
              </div>

              <div className="workflow-result-fields">
                {progress.current_result.editable_fields.length > 0 ? (
                  progress.current_result.editable_fields.map((field) => {
                    const value = getEffectiveContent(field);
                    const isModified = field in modifications;
                    const label = t(`workflow_field_${field}`) || field;

                    if (value === undefined) return null;

                    const isLargeField = ["body", "chapter_summary", "background", "core_settings", "polished_content", "original_content"].includes(field);
                    const isMultiline = typeof value === "string" && value.length > 100;

                    return (
                      <div key={field} className={`workflow-result-field ${isModified ? "workflow-result-field--modified" : ""}`}>
                        <div className="workflow-result-field__header">
                          <label className="workflow-result-field__label">{label}</label>
                          {isModified && <span className="workflow-result-field__modified-badge">{t("workflow_modified")}</span>}
                        </div>
                        {isLargeField || isMultiline ? (
                          <textarea
                            className="workflow-result-field__input workflow-result-field__textarea"
                            value={String(value)}
                            onChange={(e) => handleModificationChange(field, e.target.value)}
                            disabled={status === "running" || isExecuting || isConfirming}
                            rows={field === "body" ? 12 : 6}
                          />
                        ) : (
                          <input
                            type="text"
                            className="workflow-result-field__input"
                            value={String(value)}
                            onChange={(e) => handleModificationChange(field, e.target.value)}
                            disabled={status === "running" || isExecuting || isConfirming}
                          />
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="workflow-result-preview">
                    {Object.entries(progress.current_result.display_content).map(([key, value]) => {
                      if (value === undefined || value === null) return null;
                      const label = t(`workflow_field_${key}`) || key;
                      const isLarge = ["body", "chapter_summary", "background", "core_settings"].includes(key);

                      return (
                        <div key={key} className="workflow-result-preview__item">
                          <span className="workflow-result-preview__label">{label}</span>
                          {isLarge ? (
                            <pre className="workflow-result-preview__value workflow-result-preview__value--large">
                              {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
                            </pre>
                          ) : (
                            <span className="workflow-result-preview__value">
                              {typeof value === "string" ? value : JSON.stringify(value)}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {progress.current_result.suggestions && progress.current_result.suggestions.length > 0 && (
                <div className="workflow-suggestions-section">
                  <div className="workflow-suggestions-section__title">{t("workflow_ai_suggestions")}</div>
                  <ul className="workflow-suggestions-list">
                    {progress.current_result.suggestions.map((suggestion, index) => (
                      <li key={index} className="workflow-suggestions-list__item">
                        <span className="workflow-suggestions-list__icon">💡</span>
                        <span>{suggestion}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {progress.current_result.next_step_suggestion && (
                <div className="workflow-next-step">
                  <span className="workflow-next-step__label">{t("workflow_next_step")}:</span>
                  <span className="workflow-next-step__content">{progress.current_result.next_step_suggestion}</span>
                </div>
              )}
            </div>
          )}

          {progress?.current_result && !progress.current_result.success && (
            <div className="workflow-error-section">
              <div className="workflow-error-section__icon">❌</div>
              <div className="workflow-error-section__content">
                <div className="workflow-error-section__title">{t("workflow_generation_failed")}</div>
                <div className="workflow-error-section__message">
                  {progress.current_result.error_message || t("workflow_unknown_error")}
                </div>
              </div>
            </div>
          )}

          <div className="workflow-actions">
            {canExecute && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleExecutePhase}
                disabled={isExecuting || isLoading}
              >
                {isExecuting ? (
                  <>
                    <span className="btn__spinner"></span>
                    {t("workflow_executing")}
                  </>
                ) : (
                  t("workflow_execute")
                )}
              </button>
            )}

            {canConfirm && (
              <button
                type="button"
                className="btn btn-success"
                onClick={handleConfirmPhase}
                disabled={isConfirming || isLoading}
              >
                {isConfirming ? (
                  <>
                    <span className="btn__spinner"></span>
                    {t("workflow_confirming")}
                  </>
                ) : (
                  t("workflow_confirm")
                )}
              </button>
            )}

            {canSave && (
              <button
                type="button"
                className="btn"
                onClick={handleSaveChapter}
                disabled={isSaving || isLoading}
              >
                {isSaving ? (
                  <>
                    <span className="btn__spinner"></span>
                    {t("workflow_saving")}
                  </>
                ) : (
                  t("workflow_save_chapter")
                )}
              </button>
            )}

            {status === "running" && (
              <span className="workflow-running-indicator">
                <span className="workflow-running-indicator__spinner"></span>
                {t("workflow_running")}
              </span>
            )}
          </div>
        </div>
      )}

      <Modal
        open={showCreateModal}
        title={t("workflow_create_modal_title")}
        onCancel={() => setShowCreateModal(false)}
        onOk={handleCreateWorkflow}
        confirmLoading={isCreating}
        okText={t("common_create")}
        cancelText={t("common_cancel")}
        width={480}
      >
        <div className="workflow-create-form">
          <div className="field">
            <label>
              <span className="label-text">{t("workflow_chapter_summary")}</span>
              <span className="label--optional">{t("workflow_chapter_summary_hint")}</span>
            </label>
            <textarea
              className="textarea"
              rows={4}
              value={createForm.chapterSummary}
              onChange={(e) => setCreateForm({ ...createForm, chapterSummary: e.target.value })}
              placeholder={t("workflow_chapter_summary_placeholder")}
            />
          </div>

          <div className="field">
            <label>
              <span className="label-text">{t("workflow_fixed_title")}</span>
              <span className="label--optional">{t("workflow_fixed_title_hint")}</span>
            </label>
            <input
              type="text"
              className="input"
              value={createForm.fixedTitle}
              onChange={(e) => setCreateForm({ ...createForm, fixedTitle: e.target.value })}
              placeholder={t("workflow_fixed_title_placeholder")}
            />
          </div>

          <div className="field">
            <label>
              <span className="label-text">{t("workflow_word_count")}</span>
              <span className="label--optional">{t("workflow_word_count_hint")}</span>
            </label>
            <select
              className="input"
              value={createForm.wordCount ?? ""}
              onChange={(e) =>
                setCreateForm({
                  ...createForm,
                  wordCount: e.target.value ? Number(e.target.value) : null,
                })
              }
            >
              <option value="">{t("workflow_word_count_default")}</option>
              <option value="1000">1000 {t("workflow_words")}</option>
              <option value="2000">2000 {t("workflow_words")}</option>
              <option value="3000">3000 {t("workflow_words")}</option>
              <option value="4000">4000 {t("workflow_words")}</option>
            </select>
          </div>
        </div>
      </Modal>
    </div>
  );
}
