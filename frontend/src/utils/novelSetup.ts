import type { Novel } from "@/types";

/** 设定完成度仅用于 AI 提示，不限制手动写作。 */
export function isNovelSetupComplete(novel: Novel): boolean {
  return Boolean(novel.genre?.trim()) && Boolean(novel.background?.trim());
}

export function novelPrimaryHref(novel: Novel): string {
  return `/novels/${novel.id}/write`;
}
