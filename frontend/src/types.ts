export type User = {
  id: number;
  email: string;
  display_name: string | null;
  preferred_llm_provider?: string | null;
  /** 累计 LLM 流式调用成功次数（非 token） */
  llm_call_count?: number;

  agent_mode?: string;
  max_llm_iterations?: number;
  max_tokens_per_task?: number;
  enable_auto_audit?: boolean;
  preview_before_save?: boolean;
  auto_audit_min_score?: number;
};

export type Novel = {
  id: number;
  user_id: number;
  title: string;
  background: string;
  genre: string;
  writing_style: string;
  created_at: string;
  updated_at: string;
};

export type Chapter = {
  id: number;
  novel_id: number;
  title: string;
  summary: string;
  content: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type Character = {
  id: number;
  novel_id: number;
  name: string;
  profile: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type Memo = {
  id: number;
  novel_id: number;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
};

export type LlmUsageItem = {
  id: number;
  provider: string;
  action: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  created_at: string;
};

export type LlmUsageSummary = {
  total_calls: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  items: LlmUsageItem[];
};

export type ChapterVersion = {
  id: number;
  chapter_id: number;
  version_number: number;
  title: string;
  summary: string;
  content: string;
  change_type: string;
  created_at: string;
};

export type ChapterVersionDiff = {
  diff_html: string;
  diff_text: string;
  added_count: number;
  removed_count: number;
  changed_count: number;
  old_version?: ChapterVersion;
  new_version?: ChapterVersion;
  current_version?: {
    id: number;
    title: string;
    summary: string;
    content: string;
    updated_at: string;
  };
};

export type TaskStatus = "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type TaskType = "single_chapter" | "batch_chapters" | "rewrite_chapter" | "append_chapter";

export type TaskItem = {
  id: number;
  background_task_id: number;
  chapter_id: number | null;
  sort_order: number;
  status: TaskStatus;
  title: string | null;
  summary: string | null;
  generated_title: string | null;
  generated_content: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type BackgroundTask = {
  id: number;
  user_id: number;
  novel_id: number;
  task_type: TaskType;
  status: TaskStatus;
  title: string | null;
  summary: string | null;
  batch_count: number;
  current_index: number;
  completed_count: number;
  error_message: string | null;
  progress_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  total_tokens: number;
  task_items: TaskItem[];
};

export type TaskProgress = {
  task_id: number;
  status: TaskStatus;
  progress: number;
  current_index: number;
  completed_count: number;
  batch_count: number;
  progress_message: string | null;
  error_message: string | null;
  total_tokens: number;
  started_at: string | null;
  completed_at: string | null;
};

export type CreateSingleTaskRequest = {
  novel_id: number;
  chapter_id?: number | null;
  title?: string | null;
  summary: string;
  fixed_title?: string | null;
  word_count?: number | null;
  task_type?: "single_chapter" | "rewrite_chapter" | "append_chapter";
};

export type CreateBatchTaskRequest = {
  novel_id: number;
  after_chapter_id?: number | null;
  total_summary: string;
  chapter_count: number;
  word_count?: number | null;
};
