/**
 * 工作流系统类型定义
 * 参考后端 WorkflowState, PhaseResult 等类型
 */

export type WorkflowPhaseType =
  | "novel_setup"
  | "outline_planning"
  | "character_design"
  | "chapter_summary"
  | "chapter_content"
  | "polish";

export type WorkflowStatus =
  | "pending"
  | "running"
  | "waiting_user_confirm"
  | "completed"
  | "failed"
  | "cancelled";

export interface PhaseResult {
  phase_type: WorkflowPhaseType;
  status: WorkflowStatus;
  success: boolean;
  generated_content: Record<string, unknown>;
  suggestions: string[];
  error_message?: string;
  started_at?: string;
  completed_at?: string;
}

export interface WorkflowProgress {
  workflow_id: string;
  novel_id: number;
  current_phase: WorkflowPhaseType;
  status: WorkflowStatus;
  completed_phases: WorkflowPhaseType[];
  pending_phases: WorkflowPhaseType[];
  current_result?: PhaseDisplayResult;
  user_modifications: Record<string, Record<string, unknown>>;
  target_chapter?: number;
  target_chapter_count?: number;
}

export interface PhaseDisplayResult {
  phase_type: WorkflowPhaseType;
  success: boolean;
  error_message?: string;
  display_content: Record<string, unknown>;
  editable_fields: string[];
  suggestions: string[];
  next_step_suggestion?: string;
}

export interface CreateWorkflowRequest {
  initial_phase?: WorkflowPhaseType;
  target_chapter?: number;
  target_chapter_count?: number;
  chapter_summary?: string;
  fixed_title?: string;
  word_count?: number;
  additional_context?: Record<string, unknown>;
}

export interface CreateWorkflowResponse {
  workflow_id: string;
  novel_id: number;
  current_phase: WorkflowPhaseType;
  status: WorkflowStatus;
  progress: WorkflowProgress;
}

export interface ExecutePhaseRequest {
  user_modifications?: Record<string, unknown>;
}

export interface ExecutePhaseResponse {
  workflow_id: string;
  phase_type: WorkflowPhaseType;
  success: boolean;
  status: WorkflowStatus;
  result: PhaseDisplayResult;
  progress: WorkflowProgress;
  error_message?: string;
}

export interface ConfirmPhaseRequest {
  user_modifications?: Record<string, unknown>;
}

export interface ConfirmPhaseResponse {
  workflow_id: string;
  success: boolean;
  reason: string;
  current_phase: WorkflowPhaseType;
  status: WorkflowStatus;
  next_phase?: WorkflowPhaseType;
  progress: WorkflowProgress;
}

export interface SaveChapterResponse {
  success: boolean;
  chapter?: {
    id: number;
    title: string;
    summary?: string;
    word_count: number;
  };
  message: string;
}

export const PHASE_NAMES: Record<WorkflowPhaseType, { key: string; icon: string }> = {
  novel_setup: { key: "workflow_phase_novel_setup", icon: "📚" },
  outline_planning: { key: "workflow_phase_outline", icon: "📋" },
  character_design: { key: "workflow_phase_character", icon: "👤" },
  chapter_summary: { key: "workflow_phase_summary", icon: "📝" },
  chapter_content: { key: "workflow_phase_content", icon: "✍️" },
  polish: { key: "workflow_phase_polish", icon: "✨" },
};

export const PHASE_ORDER: WorkflowPhaseType[] = [
  "novel_setup",
  "outline_planning",
  "character_design",
  "chapter_summary",
  "chapter_content",
  "polish",
];

export const CHAPTER_PHASES: WorkflowPhaseType[] = [
  "chapter_summary",
  "chapter_content",
  "polish",
];

export function getPhaseIndex(phase: WorkflowPhaseType, phases: WorkflowPhaseType[] = PHASE_ORDER): number {
  return phases.indexOf(phase);
}

export function isPhaseActive(
  phase: WorkflowPhaseType,
  currentPhase: WorkflowPhaseType,
  _phases: WorkflowPhaseType[] = PHASE_ORDER
): boolean {
  return phase === currentPhase;
}

export function isPhaseCompleted(
  phase: WorkflowPhaseType,
  currentPhase: WorkflowPhaseType,
  completedPhases: WorkflowPhaseType[],
  phases: WorkflowPhaseType[] = PHASE_ORDER
): boolean {
  if (completedPhases.includes(phase)) {
    return true;
  }
  const phaseIdx = getPhaseIndex(phase, phases);
  const currentIdx = getPhaseIndex(currentPhase, phases);
  return phaseIdx < currentIdx;
}

export function canExecutePhase(
  phase: WorkflowPhaseType,
  currentPhase: WorkflowPhaseType,
  status: WorkflowStatus,
  _phases: WorkflowPhaseType[] = PHASE_ORDER
): boolean {
  if (phase !== currentPhase) {
    return false;
  }
  return status === "pending" || status === "waiting_user_confirm" || status === "failed";
}

export function canConfirmPhase(status: WorkflowStatus): boolean {
  return status === "waiting_user_confirm";
}

export function canSaveChapter(status: WorkflowStatus, currentPhase: WorkflowPhaseType): boolean {
  return (
    status === "waiting_user_confirm" &&
    (currentPhase === "chapter_content" || currentPhase === "polish")
  );
}
