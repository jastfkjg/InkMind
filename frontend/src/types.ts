export type User = {
  id: number;
  email: string;
  display_name: string | null;
  preferred_llm_provider?: string | null;
  /** 累计 LLM 流式调用成功次数（非 token） */
  llm_call_count?: number;
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
  token_quota: number;
  token_remaining: number;
  items: LlmUsageItem[];
};
