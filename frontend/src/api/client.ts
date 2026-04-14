import axios, { AxiosError } from "axios";
import type { Chapter, Character, Novel, User } from "@/types";

const baseURL =
  import.meta.env.VITE_API_URL?.replace(/\/$/, "") ||
  (import.meta.env.DEV ? "/api" : "http://127.0.0.1:8000");

export const api = axios.create({ baseURL });

const TOKEN_KEY = "inkmind_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

api.interceptors.request.use((config) => {
  const t = getToken();
  if (t) {
    config.headers.Authorization = `Bearer ${t}`;
  }
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

export async function patchAuthMe(payload: { preferred_llm_provider?: string | null }) {
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
  options?: { chapterId?: number | null; title?: string | null }
) {
  const { data } = await api.post<Chapter>(`/novels/${novelId}/chapters/generate`, {
    summary,
    chapter_id: options?.chapterId ?? null,
    title: options?.title?.trim() ? options.title.trim() : null,
  });
  return data;
}

export async function reviseChapter(
  novelId: number,
  chapterId: number,
  instruction: string,
  llmProvider?: string | null,
  mode: "rewrite" | "append" = "rewrite"
) {
  const { data } = await api.post<Chapter>(`/novels/${novelId}/chapters/${chapterId}/revise`, {
    instruction,
    llm_provider: llmProvider || null,
    mode,
  });
  return data;
}

export async function novelAiNaming(
  novelId: number,
  payload: { category: "character" | "item" | "skill" | "other"; description: string; hint?: string | null }
) {
  const { data } = await api.post<{ text: string }>(`/novels/${novelId}/ai-naming`, {
    category: payload.category,
    description: payload.description,
    hint: payload.hint?.trim() || null,
  });
  return data;
}

export async function novelAiChat(
  novelId: number,
  payload: { message: string; history: { role: string; content: string }[] }
) {
  const { data } = await api.post<{ reply: string }>(`/novels/${novelId}/ai-chat`, payload);
  return data;
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

export async function fetchLlmProviders() {
  const { data } = await api.get<{ available: string[]; default: string }>("/meta/llm-providers");
  return data;
}
