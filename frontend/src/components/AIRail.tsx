import { useMemo } from "react";
import { useI18n } from "@/i18n";
import { RAIL_ITEM_KEYS, type AiTool } from "@/types/write";

export interface AIRailProps {
  rightTool: AiTool | null;
  activeId: number | null;
  hasLlm: boolean;
  onToggleTool: (tool: AiTool) => void;
}

function needsChapter(tool: AiTool): boolean {
  return tool === "generate" || tool === "rewrite" || tool === "append" || tool === "evaluate" || tool === "versions";
}

function canOpenTool(tool: AiTool, activeId: number | null, hasLlm: boolean): boolean {
  if (tool === "versions") {
    return activeId !== null;
  }
  if (!hasLlm) return false;
  if (needsChapter(tool)) return activeId !== null;
  return true;
}

export default function AIRail({ rightTool, activeId, hasLlm, onToggleTool }: AIRailProps) {
  const { t } = useI18n();

  const RAIL_ITEMS = useMemo(
    () => RAIL_ITEM_KEYS.map(({ key, labelKey }) => ({ key, line2: t(labelKey) })),
    [t]
  );

  return (
    <nav className="write-ai-rail" aria-label={t("write_ai_features")}>
      {RAIL_ITEMS.map(({ key, line2 }) => (
        <button
          key={key}
          type="button"
          className={`write-rail-btn${rightTool === key ? " active" : ""}`}
          disabled={!canOpenTool(key, activeId, hasLlm)}
          title={
            !hasLlm
              ? t("write_err_no_llm")
              : needsChapter(key) && !activeId
                ? t("write_please_select_chapter")
                : `AI${line2}`
          }
          onClick={() => onToggleTool(key)}
        >
          <span className="write-rail-stack">
            <span className="write-rail-ai">AI</span>
            <span className="write-rail-name">{line2}</span>
          </span>
        </button>
      ))}
    </nav>
  );
}
