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
