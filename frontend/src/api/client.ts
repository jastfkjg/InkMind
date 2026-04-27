import axios, { AxiosError } from "axios";
import type { BackgroundTask, Chapter, ChapterVersion, ChapterVersionDiff, Character, CreateBatchTaskRequest, CreateSingleTaskRequest, LlmUsageSummary, Memo, Novel, TaskProgress, User } from "@/types";

const baseURL =
  import.meta.env.VITE_API_URL?.replace(/\/$/, "") ||
  (import.meta.env.DEV ? "/api" : "http://127.0.0.1:8000");

export const api = axios.create({ baseURL });

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
  options?: { onToken?: (chunk: string) => void; signal?: AbortSignal }
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
  const applyObj = (obj: Record<string, unknown>) => {
    if (typeof obj.t === "string") onToken?.(obj.t);
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
  agent_mode?: string | null;
  max_llm_iterations?: number | null;
  max_tokens_per_task?: number | null;
  enable_auto_audit?: boolean | null;
  preview_before_save?: boolean | null;
  auto_audit_min_score?: number | null;
  ai_language?: string | null;
}) {
  const { data } = await api.patch<User>("/auth/me", payload);
  return data;
}

export async function fetchNovels() {
  const { data } = await api.get<Novel[]>("/novels");
  return data;
}

export async function createNovel(payload: Partial<Pick<Novel, "title" | "background" | "genre" | "writing_style">>) {
  const { data } = await api.post<Novel>("/novels", payload);
  return data;
}

export async function fetchNovel(id: number) {
  const { data } = await api.get<Novel>(`/novels/${id}`);
  return data;
}

export async function updateNovel(
  id: number,
  payload: Partial<Pick<Novel, "title" | "background" | "genre" | "writing_style">>) {
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
    wordCount?: number | null;
    onToken?: (chunk: string) => void;
  }
): Promise<NdjsonAiResult> {
  const r = await postNdjsonAi(
    `/novels/${novelId}/chapters/generate`,
    {
      summary,
      chapter_id: options?.chapterId ?? null,
      title: options?.title?.trim() ? options.title.trim() : null,
      lock_title: options?.lockTitle ?? false,
      word_count: (options?.wordCount && options.wordCount >= 500 && options.wordCount <= 4000) ? options.wordCount : null,
    },
    { onToken: options?.onToken }
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
    word_count?: number | null;
  },
  options?: { onToken?: (chunk: string) => void; signal?: AbortSignal }
) {
  const r = await postNdjsonAi(
    `/novels/${novelId}/chapters/generate-batch`,
    {
      ...payload,
      word_count: (payload.word_count && payload.word_count >= 500 && payload.word_count <= 4000) ? payload.word_count : null,
    },
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
    mode: "expand" | "polish";
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
  const { data } = await api.get<{ available: string[]; default: string }>("/meta/llm-providers");
  return data;
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
    word_count: (payload.word_count && payload.word_count >= 500 && payload.word_count <= 4000) ? payload.word_count : null,
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
    word_count: (payload.word_count && payload.word_count >= 500 && payload.word_count <= 4000) ? payload.word_count : null,
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
