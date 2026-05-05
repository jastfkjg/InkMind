import { useI18n } from "@/i18n";
import {
  type WorkflowProgress as WorkflowProgressType,
  type WorkflowPhaseType,
  type WorkflowStatus,
  PHASE_NAMES,
  PHASE_ORDER,
  CHAPTER_PHASES,
  isPhaseActive,
  isPhaseCompleted,
} from "@/types/workflow";

export interface WorkflowProgressProps {
  progress?: WorkflowProgressType | null;
  showOnlyChapterPhases?: boolean;
  className?: string;
}

function getPhaseStatusIcon(
  _phase: WorkflowPhaseType,
  status: WorkflowStatus,
  isActive: boolean,
  isCompleted: boolean
): string {
  if (isActive) {
    if (status === "running") return "⏳";
    if (status === "waiting_user_confirm") return "⏸️";
    if (status === "failed") return "❌";
    return "⚡";
  }
  if (isCompleted) return "✅";
  return "○";
}

function getPhaseStatusClass(
  _phase: WorkflowPhaseType,
  status: WorkflowStatus,
  isActive: boolean,
  isCompleted: boolean
): string {
  const baseClass = "workflow-phase";
  if (isActive) {
    if (status === "running") return `${baseClass} is-active is-running`;
    if (status === "waiting_user_confirm") return `${baseClass} is-active is-waiting`;
    if (status === "failed") return `${baseClass} is-active is-failed`;
    return `${baseClass} is-active`;
  }
  if (isCompleted) return `${baseClass} is-completed`;
  return `${baseClass} is-pending`;
}

export default function WorkflowProgress({
  progress,
  showOnlyChapterPhases = false,
  className = "",
}: WorkflowProgressProps) {
  const { t } = useI18n();

  if (!progress) {
    return (
      <div className={`workflow-progress-empty ${className}`}>
        <p className="muted">{t("workflow_no_active")}</p>
      </div>
    );
  }

  const phases = showOnlyChapterPhases ? CHAPTER_PHASES : PHASE_ORDER;
  const currentPhase = progress.current_phase;
  const workflowStatus = progress.status;
  const completedPhases = progress.completed_phases;

  return (
    <div className={`workflow-progress ${className}`}>
      <div className="workflow-progress-header">
        <span className="workflow-status-badge">
          {workflowStatus === "running" && (
            <span className="status-indicator status-running">
              <span className="status-dot"></span>
              {t("workflow_status_running")}
            </span>
          )}
          {workflowStatus === "waiting_user_confirm" && (
            <span className="status-indicator status-waiting">
              <span className="status-dot"></span>
              {t("workflow_status_waiting")}
            </span>
          )}
          {workflowStatus === "completed" && (
            <span className="status-indicator status-completed">
              <span className="status-dot"></span>
              {t("workflow_status_completed")}
            </span>
          )}
          {workflowStatus === "failed" && (
            <span className="status-indicator status-failed">
              <span className="status-dot"></span>
              {t("workflow_status_failed")}
            </span>
          )}
          {workflowStatus === "pending" && (
            <span className="status-indicator status-pending">
              <span className="status-dot"></span>
              {t("workflow_status_pending")}
            </span>
          )}
        </span>
        <span className="workflow-id muted">ID: {progress.workflow_id.slice(0, 8)}...</span>
      </div>

      <div className="workflow-phases">
        {phases.map((phase, index) => {
          const phaseInfo = PHASE_NAMES[phase];
          const isActive = isPhaseActive(phase, currentPhase, phases);
          const isCompleted = isPhaseCompleted(phase, currentPhase, completedPhases, phases);
          const statusClass = getPhaseStatusClass(phase, workflowStatus, isActive, isCompleted);
          const statusIcon = getPhaseStatusIcon(phase, workflowStatus, isActive, isCompleted);
          const isLast = index === phases.length - 1;

          return (
            <div key={phase} className="workflow-phase-wrapper">
              <div className={statusClass}>
                <span className="workflow-phase-icon">{statusIcon}</span>
                <span className="workflow-phase-label">{t(phaseInfo.key)}</span>
              </div>
              {!isLast && <div className="workflow-phase-connector"></div>}
            </div>
          );
        })}
      </div>

      {progress.current_result && progress.current_result.suggestions.length > 0 && (
        <div className="workflow-suggestions">
          <strong className="workflow-suggestions-title">{t("workflow_suggestions")}</strong>
          <ul className="workflow-suggestions-list">
            {progress.current_result.suggestions.map((suggestion, index) => (
              <li key={index} className="workflow-suggestion-item">
                <span className="suggestion-bullet">💡</span>
                <span>{suggestion}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {progress.current_result?.next_step_suggestion && (
        <div className="workflow-next-step">
          <strong>{t("workflow_next_step")}:</strong>
          <span>{progress.current_result.next_step_suggestion}</span>
        </div>
      )}
    </div>
  );
}
