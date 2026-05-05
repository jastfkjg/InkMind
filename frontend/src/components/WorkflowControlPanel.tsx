import { useCallback, useState } from "react";
import { useI18n } from "@/i18n";
import {
  WorkflowProgress,
  WorkflowPhaseType,
  type CreateWorkflowRequest,
  canExecutePhase,
  canConfirmPhase,
  canSaveChapter,
} from "@/types/workflow";
import {
  createWorkflow,
  executePhase,
  confirmPhase,
  saveWorkflowChapter,
} from "@/api/client";
import { message, Modal } from "antd";
import type { Chapter } from "@/types";

export interface WorkflowControlPanelProps {
  novelId: number;
  progress?: WorkflowProgress | null;
  workflowId?: string | null;
  onWorkflowCreate?: (response: { workflowId: string; progress: WorkflowProgress }) => void;
  onProgressUpdate?: (progress: WorkflowProgress) => void;
  onChapterSaved?: (chapter: Partial<Chapter> & { id: number; title: string }) => void;
  onError?: (error: Error) => void;
  showOnlyChapterPhases?: boolean;
  className?: string;
}

export default function WorkflowControlPanel({
  novelId,
  progress,
  workflowId,
  onWorkflowCreate,
  onProgressUpdate,
  onChapterSaved,
  onError,
  showOnlyChapterPhases = false,
  className = "",
}: WorkflowControlPanelProps) {
  const { t } = useI18n();
  const [isCreating, setIsCreating] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    initialPhase: (showOnlyChapterPhases ? "chapter_summary" : "chapter_summary") as WorkflowPhaseType,
    chapterSummary: "",
    fixedTitle: "",
    wordCount: null as number | null,
  });

  const currentPhase = progress?.current_phase;
  const status = progress?.status;

  const canExecute = currentPhase && status ? canExecutePhase(currentPhase, currentPhase, status) : false;
  const canConfirm = status ? canConfirmPhase(status) : false;
  const canSave = currentPhase && status ? canSaveChapter(status, currentPhase) : false;
  const hasActiveWorkflow = !!workflowId && !!progress;

  const handleCreateWorkflow = useCallback(async () => {
    setIsCreating(true);
    try {
      const payload: CreateWorkflowRequest = {
        initial_phase: createForm.initialPhase,
      };

      if (createForm.chapterSummary) {
        payload.chapter_summary = createForm.chapterSummary;
        payload.initial_phase = "chapter_content";
      }
      if (createForm.fixedTitle) {
        payload.fixed_title = createForm.fixedTitle;
      }
      if (createForm.wordCount && createForm.wordCount >= 500 && createForm.wordCount <= 4000) {
        payload.word_count = createForm.wordCount;
      }

      const response = await createWorkflow(novelId, payload);
      onWorkflowCreate?.({
        workflowId: response.workflow_id,
        progress: response.progress,
      });
      setShowCreateModal(false);
      message.success(t("workflow_create_success"));
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      message.error(`${t("workflow_create_failed")}: ${err.message}`);
      onError?.(err);
    } finally {
      setIsCreating(false);
    }
  }, [novelId, createForm, onWorkflowCreate, onError, t]);

  const handleExecutePhase = useCallback(async () => {
    if (!workflowId) return;

    setIsExecuting(true);
    try {
      const response = await executePhase(novelId, workflowId);
      onProgressUpdate?.(response.progress);
      message.success(t("workflow_execute_success"));
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      message.error(`${t("workflow_execute_failed")}: ${err.message}`);
      onError?.(err);
    } finally {
      setIsExecuting(false);
    }
  }, [novelId, workflowId, onProgressUpdate, onError, t]);

  const handleConfirmPhase = useCallback(async () => {
    if (!workflowId) return;

    setIsConfirming(true);
    try {
      const response = await confirmPhase(novelId, workflowId);
      onProgressUpdate?.(response.progress);

      if (response.success) {
        if (response.next_phase) {
          message.success(
            `${t("workflow_confirm_success")} ${t(`workflow_phase_${response.next_phase}`)}`
          );
        } else {
          message.success(t("workflow_all_phases_complete"));
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      message.error(`${t("workflow_confirm_failed")}: ${err.message}`);
      onError?.(err);
    } finally {
      setIsConfirming(false);
    }
  }, [novelId, workflowId, onProgressUpdate, onError, t]);

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
          const response = await saveWorkflowChapter(novelId, workflowId);
          if (response.success && response.chapter) {
            message.success(t("workflow_save_success"));
            onChapterSaved?.(response.chapter);
          } else {
            message.error(response.message || t("workflow_save_failed"));
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          message.error(`${t("workflow_save_failed")}: ${err.message}`);
          onError?.(err);
        } finally {
          setIsSaving(false);
        }
      },
    });
  }, [novelId, workflowId, onChapterSaved, onError, t]);

  return (
    <div className={`workflow-control-panel ${className}`}>
      {!hasActiveWorkflow ? (
        <div className="workflow-empty-state">
          <p className="muted">{t("workflow_no_active")}</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowCreateModal(true)}
          >
            {t("workflow_start_new")}
          </button>
        </div>
      ) : (
        <div className="workflow-actions">
          {canExecute && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleExecutePhase}
              disabled={isExecuting}
            >
              {isExecuting ? t("workflow_executing") : t("workflow_execute")}
            </button>
          )}

          {canConfirm && (
            <button
              type="button"
              className="btn btn-success"
              onClick={handleConfirmPhase}
              disabled={isConfirming}
            >
              {isConfirming ? t("workflow_confirming") : t("workflow_confirm")}
            </button>
          )}

          {canSave && (
            <button
              type="button"
              className="btn"
              onClick={handleSaveChapter}
              disabled={isSaving}
            >
              {isSaving ? t("workflow_saving") : t("workflow_save_chapter")}
            </button>
          )}

          {status === "running" && (
            <span className="workflow-status-running">
              <span className="status-spinner"></span>
              {t("workflow_running")}
            </span>
          )}
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
      >
        <div className="workflow-create-form stack-md">
          {!showOnlyChapterPhases && (
            <div className="form-field">
              <label className="form-label">{t("workflow_start_phase")}</label>
              <select
                className="form-select"
                value={createForm.initialPhase}
                onChange={(e) =>
                  setCreateForm({ ...createForm, initialPhase: e.target.value as WorkflowPhaseType })
                }
              >
                <option value="novel_setup">{t("workflow_phase_novel_setup")}</option>
                <option value="outline_planning">{t("workflow_phase_outline")}</option>
                <option value="character_design">{t("workflow_phase_character")}</option>
                <option value="chapter_summary">{t("workflow_phase_summary")}</option>
              </select>
            </div>
          )}

          <div className="form-field">
            <label className="form-label">
              {t("workflow_chapter_summary")}
              <span className="form-hint">{t("workflow_chapter_summary_hint")}</span>
            </label>
            <textarea
              className="form-textarea"
              rows={4}
              value={createForm.chapterSummary}
              onChange={(e) => setCreateForm({ ...createForm, chapterSummary: e.target.value })}
              placeholder={t("workflow_chapter_summary_placeholder")}
            />
          </div>

          <div className="form-field">
            <label className="form-label">
              {t("workflow_fixed_title")}
              <span className="form-hint">{t("workflow_fixed_title_hint")}</span>
            </label>
            <input
              type="text"
              className="form-input"
              value={createForm.fixedTitle}
              onChange={(e) => setCreateForm({ ...createForm, fixedTitle: e.target.value })}
              placeholder={t("workflow_fixed_title_placeholder")}
            />
          </div>

          <div className="form-field">
            <label className="form-label">
              {t("workflow_word_count")}
              <span className="form-hint">{t("workflow_word_count_hint")}</span>
            </label>
            <select
              className="form-select"
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
