import axios, { AxiosError } from "axios";
import type { BackgroundTask, Chapter, ChapterVersion, ChapterVersionDiff, Character, CreateBatchTaskRequest, CreateSingleTaskRequest, CustomLlmInfo, LlmProvidersResponse, LlmUsageSummary, Memo, Novel, NovelListItem, TaskProgress, User } from "@/types";
import type {
  WorkflowProgress,
  CreateWorkflowRequest,
  CreateWorkflowResponse,
  ExecutePhaseRequest,
  ExecutePhaseResponse,
  ConfirmPhaseRequest,
  ConfirmPhaseResponse,
  SaveChapterResponse,
} from "@/types/workflow";

const desktopApiBaseUrl = window.inkMindDesktop?.apiBaseUrl?.replace(/\/$/, "");

const baseURL =
  desktopApiBaseUrl || import.meta.env.VITE_API_URL?.replace(/\/$/, "") ||
  (import.meta.env.DEV ? "/api" : "http://127.0.0.1:8000");

export const api = axios.create({ baseURL });

export const isDesktopApp = window.inkMindDesktop?.isDesktop === true;

export async function getDesktopSession() {
  if (!window.inkMindDesktop) throw new Error("桌面运行环境不可用");
  return window.inkMindDesktop.getSession();
}

/** AI 评估结果（与后端 ChapterEvaluateOut 一致） */
export type ChapterEvaluateResult = {
  issues: { aspect: string; detail: string }[];
  de_ai_score: number;
};

/** AI 生成预览结果 */
export type ChapterPreviewResult = {
  title: string;
  content: string;
  summary: string;
  evaluate_result?: ChapterEvaluateResult;
  needs_revision: boolean;
};

export type ProgressEvent = {
  type: "thinking" | "tool_call" | "tool_result" | "generating" | "finished" | "info" | "step";
  message: string;
  detail?: string;
  tool?: string;
  step?: number;
  total?: number;
};

export type NdjsonAiResult = {
  chapter?: Chapter;
  chapters?: Chapter[];
  title?: string;
  reply?: string;
  text?: string;
  summary?: string;
  evaluate?: ChapterEvaluateResult;
  preview?: ChapterPreviewResult;
};

const TOKEN_KEY = "inkmind_token";
const LANGUAGE_KEY = "inkmind_language";
const AI_LANGUAGE_KEY = "inkmind_ai_language";

export function getCurrentLanguage(): string {
  const aiLanguage = localStorage.getItem(AI_LANGUAGE_KEY);
  if (aiLanguage === "zh") {
    return "zh-CN";
  }
  if (aiLanguage === "en") {
    return "en";
  }
  
  const uiLanguage = localStorage.getItem(LANGUAGE_KEY);
  if (uiLanguage === "en") {
    return "en";
  }
  return "zh-CN";
}

export function setAiLanguage(language: string | null): void {
  if (language === "zh" || language === "en") {
    localStorage.setItem(AI_LANGUAGE_KEY, language);
  } else {
    localStorage.removeItem(AI_LANGUAGE_KEY);
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/** POST NDJSON 流：每行一个 JSON，含 token 片段 `t` 与最终字段（chapter / reply / text / summary / title）。 */
export async function postNdjsonAi(
  path: string,
  body: unknown,
  options?: { onToken?: (chunk: string) => void; onProgress?: (progress: ProgressEvent) => void; signal?: AbortSignal }
): Promise<NdjsonAiResult> {
  const token = getToken();
  const url = `${baseURL}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": getCurrentLanguage(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: options?.signal,
  });
  if (!res.ok) {
    const text = await res.text();
    try {
      const j = JSON.parse(text) as { detail?: string | string[] };
      const d = j.detail;
      if (typeof d === "string") throw new Error(d);
      if (Array.isArray(d)) throw new Error(d.map((x) => String(x)).join("; "));
    } catch (e) {
      if (e instanceof Error && !(e instanceof SyntaxError)) throw e;
    }
    throw new Error(text || res.statusText || `HTTP ${res.status}`);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("无响应流");
  const dec = new TextDecoder();
  let buffer = "";
  const out: NdjsonAiResult = {};
  const onToken = options?.onToken;
  const onProgress = options?.onProgress;
  const applyObj = (obj: Record<string, unknown>) => {
    if (typeof obj.t === "string") onToken?.(obj.t);
    if ("progress" in obj && obj.progress != null && typeof obj.progress === "object") {
      onProgress?.(obj.progress as ProgressEvent);
    }
    if ("error" in obj && obj.error != null) throw new Error(String(obj.error));
    if ("chapter" in obj) out.chapter = obj.chapter as Chapter;
    if ("chapters" in obj && Array.isArray(obj.chapters)) out.chapters = obj.chapters as Chapter[];
    if ("title" in obj && typeof obj.title === "string") out.title = obj.title;
    if ("reply" in obj && typeof obj.reply === "string") out.reply = obj.reply;
    if ("text" in obj && typeof obj.text === "string") out.text = obj.text;
    if ("summary" in obj && typeof obj.summary === "string") out.summary = obj.summary;
    if ("evaluate" in obj && obj.evaluate != null && typeof obj.evaluate === "object") {
      out.evaluate = obj.evaluate as ChapterEvaluateResult;
    }
    if ("preview" in obj && obj.preview != null && typeof obj.preview === "object") {
      out.preview = obj.preview as ChapterPreviewResult;
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (value) buffer += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      applyObj(JSON.parse(line) as Record<string, unknown>);
    }
    if (done) break;
  }
  const tail = buffer.trim();
  if (tail) {
    try {
      applyObj(JSON.parse(tail) as Record<string, unknown>);
    } catch (e) {
      if (e instanceof SyntaxError) {
        /* incomplete line — ignore */
      } else throw e;
    }
  }
  return out;
}

api.interceptors.request.use((config) => {
  const t = getToken();
  if (t) {
    config.headers.Authorization = `Bearer ${t}`;
  }
  config.headers["Accept-Language"] = getCurrentLanguage();
  return config;
});

export function apiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const ax = err as AxiosError<{ detail?: string | string[] }>;
    const d = ax.response?.data?.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) return d.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("; ");
  }
  if (err instanceof Error) return err.message;
  return "请求失败";
}

export async function authRegister(email: string, password: string, display_name?: string) {
  const { data } = await api.post<{ access_token: string; user: User }>("/auth/register", {
    email,
    password,
    display_name: display_name || null,
  });
  return data;
}

export async function authLogin(email: string, password: string) {
  const { data } = await api.post<{ access_token: string; user: User }>("/auth/login", {
    email,
    password,
  });
  return data;
}

export async function authMe() {
  const { data } = await api.get<User>("/auth/me");
  return data;
}

export async function patchAuthMe(payload: {
  preferred_llm_provider?: string | null;
  preferred_llm_model?: string | null;
  agent_mode?: string | null;
  max_llm_iterations?: number | null;
  max_tokens_per_task?: number | null;
  enable_auto_audit?: boolean | null;
  preview_before_save?: boolean | null;
  auto_audit_min_score?: number | null;
  ai_language?: string | null;
  agent_use_custom?: boolean | null;
  agent_custom_llm_id?: number | null;
  agent_model?: string | null;
  generation_use_custom?: boolean | null;
  generation_custom_llm_id?: number | null;
}) {
  const { data } = await api.patch<User>("/auth/me", payload);
  return data;
}

export async function fetchNovels() {
  const { data } = await api.get<NovelListItem[]>("/novels");
  return data;
}

export async function createNovel(payload: Partial<Pick<Novel, "title" | "background" | "genre" | "writing_style">> & { create_first_chapter?: boolean }) {
  const { data } = await api.post<Novel>("/novels", payload);
  return data;
}

export async function fetchNovel(id: number) {
  const { data } = await api.get<Novel>(`/novels/${id}`);
  return data;
}

export async function updateNovel(
  id: number,
  payload: Partial<Pick<Novel, "title" | "background" | "genre" | "writing_style" | "is_pinned" | "is_archived">>) {
  const { data } = await api.patch<Novel>(`/novels/${id}`, payload);
  return data;
}

export async function deleteNovel(id: number) {
  await api.delete(`/novels/${id}`);
}

export async function fetchChapters(novelId: number) {
  const { data } = await api.get<Chapter[]>(`/novels/${novelId}/chapters`);
  return data;
}

export async function createChapter(novelId: number, payload: Partial<Chapter>) {
  const { data } = await api.post<Chapter>(`/novels/${novelId}/chapters`, {
    title: payload.title ?? "",
    summary: payload.summary ?? "",
    content: payload.content ?? "",
    sort_order: payload.sort_order ?? 0,
  });
  return data;
}

export async function updateChapter(novelId: number, chapterId: number, payload: Partial<Chapter>) {
  const { data } = await api.patch<Chapter>(`/novels/${novelId}/chapters/${chapterId}`, payload);
  return data;
}

export async function deleteChapter(novelId: number, chapterId: number) {
  await api.delete(`/novels/${novelId}/chapters/${chapterId}`);
}

export async function generateChapter(
  novelId: number,
  summary: string,
  options?: {
    chapterId?: number | null;
    title?: string | null;
    lockTitle?: boolean;
    onToken?: (chunk: string) => void;
    onProgress?: (progress: ProgressEvent) => void;
  }
): Promise<NdjsonAiResult> {
  const r = await postNdjsonAi(
    `/novels/${novelId}/chapters/generate`,
    {
      summary,
      chapter_id: options?.chapterId ?? null,
      title: options?.title?.trim() ? options.title.trim() : null,
      lock_title: options?.lockTitle ?? false,
    },
    { onToken: options?.onToken, onProgress: options?.onProgress }
  );
  return r;
}

export async function confirmChapterGeneration(
  novelId: number,
  payload: {
    chapter_id: number | null;
    title: string;
    content: string;
    summary: string;
  }
): Promise<Chapter> {
  const { data } = await api.post<Chapter>(
    `/novels/${novelId}/chapters/confirm-generation`,
    {
      chapter_id: payload.chapter_id,
      title: payload.title,
      content: payload.content,
      summary: payload.summary,
    }
  );
  return data;
}

export async function generateChapterBatch(
  novelId: number,
  payload: {
    chapter_count: number;
    total_summary: string;
    after_chapter_id?: number | null;
  },
  options?: { onToken?: (chunk: string) => void; signal?: AbortSignal }
) {
  const r = await postNdjsonAi(
    `/novels/${novelId}/chapters/generate-batch`,
    payload,
    { onToken: options?.onToken, signal: options?.signal }
  );
  if (!r.chapters) throw new Error("未收到批量章节数据");
  return r.chapters;
}

export async function reviseChapter(
  novelId: number,
  chapterId: number,
  instruction: string,
  llmProvider?: string | null,
  mode: "rewrite" | "append" = "rewrite",
  onToken?: (chunk: string) => void
) {
  const r = await postNdjsonAi(
    `/novels/${novelId}/chapters/${chapterId}/revise`,
    {
      instruction,
      llm_provider: llmProvider || null,
      mode,
    },
    { onToken }
  );
  if (!r.chapter) throw new Error("未收到章节数据");
  return r.chapter;
}

export async function novelAiNaming(
  novelId: number,
  payload: { category: "character" | "item" | "skill" | "other"; description: string; hint?: string | null },
  onToken?: (chunk: string) => void
) {
  const r = await postNdjsonAi(
    `/novels/${novelId}/ai-naming`,
    {
      category: payload.category,
      description: payload.description,
      hint: payload.hint?.trim() || null,
    },
    { onToken }
  );
  const text = r.text ?? "";
  return { text };
}

export async function novelAiChat(
  novelId: number,
  payload: { message: string; history: { role: string; content: string }[] },
  onToken?: (chunk: string) => void
) {
  const r = await postNdjsonAi(`/novels/${novelId}/ai-chat`, payload, { onToken });
  const reply = r.reply ?? "";
  return { reply };
}

export async function novelAiChapterSummaryInspire(
  novelId: number,
  payload: { chapter_id: number | null; chapter_count?: number },
  onToken?: (chunk: string) => void
) {
  const r = await postNdjsonAi(
    `/novels/${novelId}/ai-chapter-summary-inspire`,
    payload,
    { onToken }
  );
  const summary = r.summary ?? "";
  return { summary };
}

/** 评估当前章节：NDJSON 流式 token + 最终 evaluate。正文传编辑器当前值（可含未保存）。 */
export async function evaluateChapter(
  novelId: number,
  chapterId: number,
  payload: {
    title?: string;
    summary?: string;
    content?: string;
    llm_provider?: string | null;
  },
  options?: { onToken?: (chunk: string) => void; signal?: AbortSignal }
): Promise<ChapterEvaluateResult> {
  const r = await postNdjsonAi(
    `/novels/${novelId}/chapters/${chapterId}/ai-evaluate`,
    payload,
    { onToken: options?.onToken, signal: options?.signal }
  );
  if (!r.evaluate) throw new Error("未收到评估结果");
  return r.evaluate;
}

/** 正文选区扩写 / 润色（NDJSON 流 + 最终 text） */
export async function chapterSelectionAi(
  novelId: number,
  chapterId: number,
  payload: {
    mode: "rewrite" | "expand" | "polish" | "append";
    selected_text: string;
    chapter_content: string;
    llm_provider?: string | null;
  },
  options?: { onToken?: (chunk: string) => void; signal?: AbortSignal }
): Promise<{ text: string }> {
  const r = await postNdjsonAi(
    `/novels/${novelId}/chapters/${chapterId}/selection-ai`,
    payload,
    { onToken: options?.onToken, signal: options?.signal }
  );
  const text = r.text ?? "";
  return { text };
}

export async function fetchCharacters(novelId: number) {
  const { data } = await api.get<Character[]>(`/novels/${novelId}/characters`);
  return data;
}

export async function createCharacter(
  novelId: number,
  payload: Partial<Pick<Character, "name" | "profile" | "notes">>
) {
  const { data } = await api.post<Character>(`/novels/${novelId}/characters`, payload);
  return data;
}

export async function updateCharacter(
  novelId: number,
  characterId: number,
  payload: Partial<Pick<Character, "name" | "profile" | "notes">>
) {
  const { data } = await api.patch<Character>(`/novels/${novelId}/characters/${characterId}`, payload);
  return data;
}

export async function deleteCharacter(novelId: number, characterId: number) {
  await api.delete(`/novels/${novelId}/characters/${characterId}`);
}

export async function fetchMemos(novelId: number) {
  const { data } = await api.get<Memo[]>(`/novels/${novelId}/memos`);
  return data;
}

export async function createMemo(novelId: number, payload: Partial<Pick<Memo, "title" | "body">>) {
  const { data } = await api.post<Memo>(`/novels/${novelId}/memos`, {
    title: payload.title ?? "",
    body: payload.body ?? "",
  });
  return data;
}

export async function updateMemo(
  novelId: number,
  memoId: number,
  payload: Partial<Pick<Memo, "title" | "body">>
) {
  const { data } = await api.patch<Memo>(`/novels/${novelId}/memos/${memoId}`, payload);
  return data;
}

export async function deleteMemo(novelId: number, memoId: number) {
  await api.delete(`/novels/${novelId}/memos/${memoId}`);
}

export async function fetchLlmProviders() {
  const { data } = await api.get<LlmProvidersResponse>("/meta/llm-providers");
  return data;
}

export async function listCustomLLMs(): Promise<CustomLlmInfo[]> {
  const { data } = await api.get<CustomLlmInfo[]>("/custom-llms");
  return data;
}

export async function createCustomLLM(payload: {
  protocol?: "openai" | "anthropic";
  provider: string;
  api_key: string;
  base_url?: string | null;
}): Promise<CustomLlmInfo> {
  const { data } = await api.post<CustomLlmInfo>("/custom-llms", payload);
  return data;
}

export async function updateCustomLLM(
  id: number,
  payload: {
    provider?: string;
    protocol?: "openai" | "anthropic";
    api_key?: string;
    base_url?: string | null;
  }
): Promise<CustomLlmInfo> {
  const { data } = await api.patch<CustomLlmInfo>(`/custom-llms/${id}`, payload);
  return data;
}

export async function deleteCustomLLM(id: number): Promise<void> {
  await api.delete(`/custom-llms/${id}`);
}

async function detailFromBlob(blob: Blob): Promise<string> {
  const t = await blob.text();
  try {
    const j = JSON.parse(t) as { detail?: string | string[] };
    const d = j.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) return d.map((x) => String(x)).join("; ");
  } catch {
    /* ignore */
  }
  return t || "请求失败";
}

/** 服务端生成 PDF（含中文）。chapter_ids 为 null 表示全书。 */
export async function exportNovelPdfBlob(novelId: number, chapterIds: number[] | null): Promise<Blob> {
  try {
    const { data, headers } = await api.post<Blob>(
      `/novels/${novelId}/export/pdf`,
      { chapter_ids: chapterIds },
      { responseType: "blob" }
    );
    const ct = (headers["content-type"] || "").toLowerCase();
    if (ct.includes("application/json")) {
      throw new Error(await detailFromBlob(data));
    }
    const head = await data.slice(0, 5).arrayBuffer();
    const sig = new TextDecoder().decode(head);
    if (!sig.startsWith("%PDF")) {
      throw new Error(await detailFromBlob(data));
    }
    return data;
  } catch (e) {
    if (axios.isAxiosError(e) && e.response?.data instanceof Blob) {
      throw new Error(await detailFromBlob(e.response.data));
    }
    throw e;
  }
}


export async function fetchLlmUsage(limit = 100) {
  const { data } = await api.get<LlmUsageSummary>(`/usage/llm?limit=${Math.max(1, Math.min(500, limit))}`);
  return data;
}

export async function fetchChapterVersions(novelId: number, chapterId: number, limit = 50) {
  const { data } = await api.get<ChapterVersion[]>(
    `/novels/${novelId}/chapters/${chapterId}/versions?limit=${Math.max(1, Math.min(200, limit))}`
  );
  return data;
}

export async function fetchChapterVersionDetail(novelId: number, chapterId: number, versionId: number) {
  const { data } = await api.get<ChapterVersion>(
    `/novels/${novelId}/chapters/${chapterId}/versions/${versionId}`
  );
  return data;
}

export async function compareChapterVersions(
  novelId: number,
  chapterId: number,
  versionId1: number,
  versionId2: number
) {
  const { data } = await api.get<ChapterVersionDiff>(
    `/novels/${novelId}/chapters/${chapterId}/versions/compare?version_id_1=${versionId1}&version_id_2=${versionId2}`
  );
  return data;
}

export async function compareVersionWithCurrent(
  novelId: number,
  chapterId: number,
  versionId: number
) {
  const { data } = await api.get<ChapterVersionDiff>(
    `/novels/${novelId}/chapters/${chapterId}/versions/${versionId}/compare-current`
  );
  return data;
}

export async function rollbackChapterToVersion(
  novelId: number,
  chapterId: number,
  versionId: number,
  saveCurrent: boolean = true
) {
  const { data } = await api.post<Chapter>(
    `/novels/${novelId}/chapters/${chapterId}/rollback`,
    { version_id: versionId, save_current: saveCurrent }
  );
  return data;
}

export async function fetchBackgroundTasks(options?: {
  novelId?: number | null;
  status?: string | null;
  limit?: number;
  offset?: number;
}) {
  const params = new URLSearchParams();
  if (options?.novelId) params.append("novel_id", String(options.novelId));
  if (options?.status) params.append("status", options.status);
  if (options?.limit) params.append("limit", String(options.limit));
  if (options?.offset) params.append("offset", String(options.offset));
  
  const query = params.toString();
  const { data } = await api.get<BackgroundTask[]>(`/background-tasks${query ? `?${query}` : ""}`);
  return data;
}

export async function fetchBackgroundTask(taskId: number) {
  const { data } = await api.get<BackgroundTask>(`/background-tasks/${taskId}`);
  return data;
}

export async function fetchTaskProgress(taskId: number): Promise<TaskProgress> {
  const { data } = await api.get<TaskProgress>(`/background-tasks/${taskId}/progress`);
  return data;
}

export async function createSingleBackgroundTask(payload: CreateSingleTaskRequest): Promise<BackgroundTask> {
  const { data } = await api.post<BackgroundTask>("/background-tasks/single", {
    novel_id: payload.novel_id,
    chapter_id: payload.chapter_id ?? null,
    title: payload.title?.trim() || null,
    summary: payload.summary,
    fixed_title: payload.fixed_title?.trim() || null,
    task_type: payload.task_type || "single_chapter",
  });
  return data;
}

export async function createBatchBackgroundTask(payload: CreateBatchTaskRequest): Promise<BackgroundTask> {
  const { data } = await api.post<BackgroundTask>("/background-tasks/batch", {
    novel_id: payload.novel_id,
    after_chapter_id: payload.after_chapter_id ?? null,
    total_summary: payload.total_summary,
    chapter_count: Math.max(1, Math.min(20, payload.chapter_count)),
  });
  return data;
}

export async function cancelBackgroundTask(taskId: number): Promise<BackgroundTask> {
  const { data } = await api.post<BackgroundTask>(`/background-tasks/${taskId}/cancel`);
  return data;
}

export async function deleteBackgroundTask(taskId: number): Promise<void> {
  await api.delete(`/background-tasks/${taskId}`);
}

export async function fetchMyQuota() {
  const { data } = await api.get<{
    token_quota: number | null;
    token_quota_used: number;
    token_quota_remaining: number | null;
    token_quota_reset_at: string | null;
    is_unlimited: boolean;
  }>("/admin/me/quota");
  return data;
}

export async function fetchAdminUsers(options?: {
  page?: number;
  pageSize?: number;
  search?: string;
}) {
  const params = new URLSearchParams();
  if (options?.page) params.append("page", String(options.page));
  if (options?.pageSize) params.append("page_size", String(options.pageSize));
  if (options?.search) params.append("search", options.search);
  
  const query = params.toString();
  const { data } = await api.get<{
    total: number;
    items: Array<{
      id: number;
      email: string;
      display_name: string | null;
      is_admin: boolean;
      llm_call_count: number;
      created_at: string;
      token_quota: number | null;
      token_quota_used: number;
      token_quota_reset_at: string | null;
    }>;
  }>(`/admin/users${query ? `?${query}` : ""}`);
  return data;
}

export async function fetchAdminUser(userId: number) {
  const { data } = await api.get<{
    id: number;
    email: string;
    display_name: string | null;
    is_admin: boolean;
    llm_call_count: number;
    created_at: string;
    token_quota: number | null;
    token_quota_used: number;
    token_quota_reset_at: string | null;
  }>(`/admin/users/${userId}`);
  return data;
}

export async function updateUserQuota(
  userId: number,
  payload: {
    token_quota: number | null;
    reason?: string;
  }
) {
  const { data } = await api.patch<{
    id: number;
    email: string;
    display_name: string | null;
    is_admin: boolean;
    llm_call_count: number;
    created_at: string;
    token_quota: number | null;
    token_quota_used: number;
    token_quota_reset_at: string | null;
  }>(`/admin/users/${userId}/quota`, payload);
  return data;
}

export async function resetUserQuotaUsage(userId: number) {
  const { data } = await api.post<{
    id: number;
    email: string;
    display_name: string | null;
    is_admin: boolean;
    llm_call_count: number;
    created_at: string;
    token_quota: number | null;
    token_quota_used: number;
    token_quota_reset_at: string | null;
  }>(`/admin/users/${userId}/reset-quota-usage`);
  return data;
}

export async function fetchUserNovels(userId: number, options?: { page?: number; pageSize?: number }) {
  const params = new URLSearchParams();
  if (options?.page) params.append("page", String(options.page));
  if (options?.pageSize) params.append("page_size", String(options.pageSize));
  
  const query = params.toString();
  const { data } = await api.get<{
    total: number;
    items: Array<{
      id: number;
      title: string;
      genre: string;
      created_at: string;
      updated_at: string;
      chapter_count: number;
    }>;
  }>(`/admin/users/${userId}/novels${query ? `?${query}` : ""}`);
  return data;
}

export async function fetchUserUsage(userId: number, days: number = 30) {
  const { data } = await api.get<{
    total_calls: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_tokens: number;
  }>(`/admin/users/${userId}/usage?days=${days}`);
  return data;
}

export async function fetchQuotaChanges(options?: {
  userId?: number;
  page?: number;
  pageSize?: number;
}) {
  const params = new URLSearchParams();
  if (options?.userId) params.append("user_id", String(options.userId));
  if (options?.page) params.append("page", String(options.page));
  if (options?.pageSize) params.append("page_size", String(options.pageSize));
  
  const query = params.toString();
  const { data } = await api.get<{
    total: number;
    items: Array<{
      id: number;
      user_id: number;
      admin_id: number | null;
      old_quota: number | null;
      new_quota: number | null;
      reason: string | null;
      created_at: string;
    }>;
  }>(`/admin/quota-changes${query ? `?${query}` : ""}`);
  return data;
}

export async function fetchAdminLogs(options?: {
  action?: string;
  adminId?: number;
  targetUserId?: number;
  page?: number;
  pageSize?: number;
}) {
  const params = new URLSearchParams();
  if (options?.action) params.append("action", options.action);
  if (options?.adminId) params.append("admin_id", String(options.adminId));
  if (options?.targetUserId) params.append("target_user_id", String(options.targetUserId));
  if (options?.page) params.append("page", String(options.page));
  if (options?.pageSize) params.append("page_size", String(options.pageSize));
  
  const query = params.toString();
  const { data } = await api.get<{
    total: number;
    items: Array<{
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
    }>;
  }>(`/admin/logs${query ? `?${query}` : ""}`);
  return data;
}

export async function createWorkflow(
  novelId: number,
  payload: CreateWorkflowRequest
): Promise<CreateWorkflowResponse> {
  const { data } = await api.post<CreateWorkflowResponse>(
    `/novels/${novelId}/workflow/create`,
    payload
  );
  return data;
}

export async function fetchWorkflowProgress(
  novelId: number,
  workflowId: string
): Promise<WorkflowProgress> {
  const { data } = await api.get<WorkflowProgress>(
    `/novels/${novelId}/workflow/${workflowId}/progress`
  );
  return data;
}

export async function executePhase(
  novelId: number,
  workflowId: string,
  payload?: ExecutePhaseRequest
): Promise<ExecutePhaseResponse> {
  const { data } = await api.post<ExecutePhaseResponse>(
    `/novels/${novelId}/workflow/${workflowId}/execute`,
    payload || {}
  );
  return data;
}

export type SseEventHandler = {
  onSnapshot?: (data: import("@/types/sse").SseSnapshotData) => void;
  onPatch?: (data: import("@/types/sse").SsePatchData) => void;
  onDelta?: (data: import("@/types/sse").SseDeltaData) => void;
  onStatus?: (data: import("@/types/sse").SseStatusData) => void;
  onQuestion?: (data: import("@/types/sse").PendingQuestionData) => void;
  onAgentStep?: (data: import("@/types/sse").SseAgentStepData) => void;
  onChapterSaved?: (data: import("@/types/sse").SseChapterSavedData) => void;
  onChapterDeleted?: (data: import("@/types/sse").SseChapterDeletedData) => void;
  onError?: (data: import("@/types/sse").SseErrorData) => void;
  onDone?: (data: import("@/types/sse").SseDoneData) => void;
};

export function connectSse(
  path: string,
  body: unknown,
  handlers: SseEventHandler,
  options?: { signal?: AbortSignal }
): Promise<{ close: () => void }> {
  const token = getToken();
  const url = `${baseURL}${path.startsWith("/") ? path : `/${path}`}`;

  const controller = new AbortController();
  const signal = options?.signal;

  if (signal) {
    signal.addEventListener("abort", () => controller.abort());
  }

  let resolveReady: (value: { close: () => void }) => void;
  const ready = new Promise<{ close: () => void }>((r) => { resolveReady = r; });

  const closeObj = { close: () => controller.abort() };
  resolveReady!(closeObj);

  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": getCurrentLanguage(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const text = await res.text();
        handlers.onError?.({ message: text || `HTTP ${res.status}` });
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        handlers.onError?.({ message: "无响应流" });
        return;
      }

      const dec = new TextDecoder();
      let buffer = "";
      let currentEvent = "";
      let currentData = "";
      let sawDone = false;
      let sawError = false;

      function processLines(lines: string[]) {
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            currentData += line.slice(6);
          } else if (line === "" && currentEvent && currentData) {
            try {
              const parsed = JSON.parse(currentData);
              switch (currentEvent) {
                case "snapshot":
                  handlers.onSnapshot?.(parsed);
                  break;
                case "patch":
                  handlers.onPatch?.(parsed);
                  break;
                case "delta":
                  handlers.onDelta?.(parsed);
                  break;
                case "status":
                  handlers.onStatus?.(parsed);
                  break;
                case "question":
                  handlers.onQuestion?.(parsed);
                  break;
                case "agent_step":
                  handlers.onAgentStep?.(parsed);
                  break;
                case "chapter_saved":
                  handlers.onChapterSaved?.(parsed);
                  break;
                case "chapter_deleted":
                  handlers.onChapterDeleted?.(parsed);
                  break;
                case "error":
                  sawError = true;
                  handlers.onError?.(parsed);
                  break;
                case "done":
                  sawDone = true;
                  handlers.onDone?.(parsed);
                  break;
              }
            } catch {
              /* ignore parse errors */
            }
            currentEvent = "";
            currentData = "";
          } else if (line === "") {
            currentEvent = "";
            currentData = "";
          }
        }
      }

      while (true) {
        const { done, value } = await reader.read();
        if (value) buffer += dec.decode(value, { stream: true });
        if (done) {
          const tail = buffer.trim();
          if (tail) {
            const lines = tail.split("\n");
            processLines(lines);
          }
          break;
        }

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        processLines(lines);
      }

      if (!sawDone && !sawError && !controller.signal.aborted) {
        handlers.onError?.({ message: "连接已结束，但未收到完成事件" });
      }
    })
    .catch((err) => {
      if (err.name !== "AbortError") {
        handlers.onError?.({ message: err.message || "连接失败" });
      }
    });

  return ready;
}

export function executePhaseSse(
  novelId: number,
  workflowId: string,
  payload: ExecutePhaseRequest | undefined,
  handlers: SseEventHandler,
  options?: { signal?: AbortSignal }
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const wrappedHandlers: SseEventHandler = {
      ...handlers,
      onDone: (data) => {
        handlers.onDone?.(data);
        resolve();
      },
      onError: (data) => {
        handlers.onError?.(data);
        reject(new Error(data.message));
      },
    };

    connectSse(
      `/novels/${novelId}/workflow/${workflowId}/execute-sse`,
      payload || {},
      wrappedHandlers,
      options
    ).catch(reject);
  });
}

export function generateChapterSse(
  novelId: number,
  summary: string,
  handlers: SseEventHandler,
  options?: {
    chapterId?: number | null;
    title?: string | null;
    lockTitle?: boolean;
    signal?: AbortSignal;
  }
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const wrappedHandlers: SseEventHandler = {
      ...handlers,
      onDone: (data) => {
        handlers.onDone?.(data);
        resolve();
      },
      onError: (data) => {
        handlers.onError?.(data);
        reject(new Error(data.message));
      },
    };

    connectSse(
      `/novels/${novelId}/chapters/generate-sse`,
      {
        summary,
        chapter_id: options?.chapterId ?? null,
        title: options?.title?.trim() ? options.title.trim() : null,
        lock_title: options?.lockTitle ?? false,
      },
      wrappedHandlers,
      { signal: options?.signal }
    ).catch(reject);
  });
}

export async function executePhaseStream(
  novelId: number,
  workflowId: string,
  payload?: ExecutePhaseRequest,
  options?: { onToken?: (chunk: string) => void; onProgress?: (progress: ProgressEvent) => void }
): Promise<{ done: boolean; progress?: WorkflowProgress }> {
  const r = await postNdjsonAi(
    `/novels/${novelId}/workflow/${workflowId}/execute-stream`,
    payload || {},
    { onToken: options?.onToken, onProgress: options?.onProgress }
  );
  return {
    done: !!r,
    progress: undefined,
  };
}

export async function confirmPhase(
  novelId: number,
  workflowId: string,
  payload?: ConfirmPhaseRequest
): Promise<ConfirmPhaseResponse> {
  const { data } = await api.post<ConfirmPhaseResponse>(
    `/novels/${novelId}/workflow/${workflowId}/confirm`,
    payload || {}
  );
  return data;
}

export async function saveWorkflowChapter(
  novelId: number,
  workflowId: string,
  payload?: ConfirmPhaseRequest
): Promise<SaveChapterResponse> {
  const { data } = await api.post<SaveChapterResponse>(
    `/novels/${novelId}/workflow/${workflowId}/save-chapter`,
    payload || {}
  );
  return data;
}

export type AgentSession = {
  session_id: string;
  novel_id: number;
  status: string;
  orchestrator?: string;
  provider?: string;
};

export type AgentTaskStatus = {
  task_id: string;
  task_type: string;
  status: string;
  progress: number;
  progress_message?: string;
  result?: Record<string, unknown>;
  error?: string;
};

export async function createAgentSession(novelId: number): Promise<AgentSession> {
  const { data } = await api.post<AgentSession>(
    `/novels/${novelId}/agent/sessions`,
    {}
  );
  return data;
}

export function agentChat(
  novelId: number,
  sessionId: string,
  message: string,
  handlers: SseEventHandler,
  options?: { signal?: AbortSignal }
): Promise<{ close: () => void }> {
  return connectSse(
    `/novels/${novelId}/agent/chat`,
    { session_id: sessionId, message },
    handlers,
    options
  );
}

export async function agentAnswerQuestion(
  novelId: number,
  sessionId: string,
  questionId: string,
  answer: string,
  selectedOption?: string,
): Promise<{ status: string; resolved: boolean; synthetic?: boolean }> {
  const { data } = await api.post<{ status: string; resolved: boolean; synthetic?: boolean }>(`/novels/${novelId}/agent/answer-question`, {
    session_id: sessionId,
    question_id: questionId,
    answer,
    selected_option: selectedOption ?? null,
  });
  return data;
}

export async function updateAgentTaskOutput(
  novelId: number,
  sessionId: string,
  taskId: string,
  taskType: string,
  content: string,
): Promise<{ success: boolean }> {
  const { data } = await api.post<{ success: boolean }>(`/novels/${novelId}/agent/task-output`, {
    session_id: sessionId,
    task_id: taskId,
    task_type: taskType,
    content,
  });
  return data;
}

export async function interruptAgentSession(
  novelId: number,
  sessionId: string,
): Promise<{ success: boolean; session_id: string }> {
  const { data } = await api.post<{ success: boolean; session_id: string }>(
    `/novels/${novelId}/agent/sessions/${sessionId}/interrupt`,
    {}
  );
  return data;
}

export async function getAgentSession(
  novelId: number,
  sessionId: string
): Promise<Record<string, unknown>> {
  const { data } = await api.get(
    `/novels/${novelId}/agent/sessions/${sessionId}`
  );
  return data;
}

export async function getAgentTaskStatus(
  novelId: number,
  taskId: string
): Promise<AgentTaskStatus> {
  const { data } = await api.get<AgentTaskStatus>(
    `/novels/${novelId}/agent/tasks/${taskId}`
  );
  return data;
}

export async function cancelAgentTask(
  novelId: number,
  taskId: string
): Promise<{ success: boolean }> {
  const { data } = await api.post<{ success: boolean }>(
    `/novels/${novelId}/agent/tasks/${taskId}/cancel`
  );
  return data;
}

export type LlmConnectionStatus = "ok" | "unconfigured" | "authentication" | "permission" | "not_supported" | "timeout" | "rate_limit" | "unavailable";

export async function checkLlmConnection(target: "generation" | "agent"): Promise<{ status: LlmConnectionStatus }> {
  const { data } = await api.post<{ status: LlmConnectionStatus }>("/meta/llm-connection-test", { target }, { timeout: 20000 });
  return data;
}
