export type User = {
  id: number;
  email: string;
  display_name: string | null;
  preferred_llm_provider?: string | null;
  preferred_llm_model?: string | null;
  /** 累计 LLM 流式调用成功次数（非 token） */
  llm_call_count?: number;

  agent_mode?: string;
  max_llm_iterations?: number;
  max_tokens_per_task?: number;
  enable_auto_audit?: boolean;
  preview_before_save?: boolean;
  auto_audit_min_score?: number;
  ai_language?: string | null;

  agent_use_custom?: boolean;
  agent_custom_llm_id?: number | null;
  agent_model?: string | null;

  generation_use_custom?: boolean;
  generation_custom_llm_id?: number | null;

  is_admin?: boolean;
  token_quota?: number | null;
  token_quota_used?: number;
  token_quota_reset_at?: string | null;
};

export type BuiltinProviderInfo = {
  id: string;
  label: string;
  models: string[];
  default_model: string;
};

export type CustomLlmInfo = {
  protocol: "openai" | "anthropic";
  id: number;
  provider: string;
  provider_label: string;
  api_key: string | null;
  base_url: string | null;
  default_base_url: string | null;
  models: string[];
};

export type LlmProvidersResponse = {
  builtin: BuiltinProviderInfo[];
  default: string;
  agent_builtin: {
    model: string;
    base_url: string | null;
  } | null;
  custom_llms: CustomLlmInfo[];
  generation_custom_llm_id: number | null;
  agent_custom_llm_id: number | null;
};

export type Novel = {
  id: number;
  user_id: number;
  title: string;
  is_pinned: boolean;
  is_archived: boolean;
  background: string;
  genre: string;
  writing_style: string;
  created_at: string;
  updated_at: string;
};

export type NovelListItem = Novel & {
  chapter_count: number;
  total_words: number;
  last_chapter_id: number | null;
  last_chapter_title: string | null;
  last_edited_at: string;
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
  source: string;
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
  builtin_calls: number;
  builtin_input_tokens: number;
  builtin_output_tokens: number;
  builtin_total_tokens: number;
  custom_calls: number;
  custom_input_tokens: number;
  custom_output_tokens: number;
  custom_total_tokens: number;
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
  task_type?: "single_chapter" | "rewrite_chapter" | "append_chapter";
};

export type CreateBatchTaskRequest = {
  novel_id: number;
  after_chapter_id?: number | null;
  total_summary: string;
  chapter_count: number;
};

export type TokenQuotaStatus = {
  token_quota: number | null;
  token_quota_used: number;
  token_quota_remaining: number | null;
  token_quota_reset_at: string | null;
  is_unlimited: boolean;
};

export type AdminUser = {
  id: number;
  email: string;
  display_name: string | null;
  is_admin: boolean;
  llm_call_count: number;
  created_at: string;
  token_quota: number | null;
  token_quota_used: number;
  token_quota_reset_at: string | null;
};

export type AdminUserList = {
  total: number;
  items: AdminUser[];
};

export type TokenQuotaChange = {
  id: number;
  user_id: number;
  admin_id: number | null;
  old_quota: number | null;
  new_quota: number | null;
  reason: string | null;
  created_at: string;
};

export type TokenQuotaChangeList = {
  total: number;
  items: TokenQuotaChange[];
};

export type AdminLog = {
  id: number;
  admin_id: number;
  admin_email: string | null;
  target_user_id: number | null;
  target_user_email: string | null;
  action: string;
  resource_type: string | null;
  resource_id: number | null;
  details: string | null;
  ip_address: string | null;
  created_at: string;
};

export type AdminLogList = {
  total: number;
  items: AdminLog[];
};

export type UserNovel = {
  id: number;
  title: string;
  genre: string;
  created_at: string;
  updated_at: string;
  chapter_count: number;
};

export type UserNovelList = {
  total: number;
  items: UserNovel[];
};

export type UserUsageDetail = {
  total_calls: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
};
