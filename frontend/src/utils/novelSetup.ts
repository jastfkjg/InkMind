import type { Novel } from "@/types";

/** 是否已填写最低限度设定：类型与背景均有内容，才视为可进入写作。 */
export function isNovelSetupComplete(novel: Novel): boolean {
  return Boolean(novel.genre?.trim()) && Boolean(novel.background?.trim());
}

export function novelPrimaryHref(novel: Novel): string {
  const base = `/novels/${novel.id}`;
  return isNovelSetupComplete(novel) ? `${base}/write` : `${base}/settings`;
}
