import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import type { AiStreamOptions } from "@/api/client";

export type AiOperation = {
  id: number; kind: string; label: string; phase: string; phases: string[];
  text: string; status: "running" | "ready" | "done" | "cancelled" | "error";
  startedAt: number; phaseStartedAt: number; lastActivityAt: number; endedAt?: number;
  error?: string;
};

export function useAiOperation(scope: string) {
  const { t } = useI18n();
  const [operation, setOperation] = useState<AiOperation | null>(null);
  const active = useRef<{ id: number; controller: AbortController } | null>(null);
  const sequence = useRef(0);
  useEffect(() => {
    setOperation(null);
    return () => { active.current?.controller.abort(); active.current = null; };
  }, [scope]);

  function begin(kind: string, label: string, phase: string) {
    active.current?.controller.abort();
    const id = ++sequence.current;
    const controller = new AbortController();
    active.current = { id, controller };
    const now = Date.now();
    setOperation({ id, kind, label, phase, phases: [phase], text: "", status: "running", startedAt: now, phaseStartedAt: now, lastActivityAt: now });
    const isCurrent = () => active.current?.id === id && !controller.signal.aborted;
    const update = (fn: (op: AiOperation) => AiOperation) => {
      if (isCurrent()) setOperation((op) => op?.id === id ? fn(op) : op);
    };
    const options: AiStreamOptions = {
      signal: controller.signal,
      onToken: (chunk) => update((op) => {
        const receiving = !op.text && op.phase === phase;
        return { ...op, text: op.text + chunk, lastActivityAt: Date.now(),
          phase: receiving ? t("ai_stream_receiving") : op.phase,
          phaseStartedAt: receiving ? Date.now() : op.phaseStartedAt,
          phases: receiving ? [...op.phases, t("ai_stream_receiving")] : op.phases };
      }),
      onActivity: () => update((op) => ({ ...op, lastActivityAt: Date.now() })),
      onProgress: (progress) => update((op) => ({ ...op, phase: progress.message,
        text: progress.reset ? "" : op.text,
        phaseStartedAt: progress.message === op.phase ? op.phaseStartedAt : Date.now(),
        phases: progress.message === op.phase ? op.phases : [...op.phases, progress.message],
        lastActivityAt: Date.now(),
      })),
    };
    return {
      options, isCurrent,
      complete: (text?: string, ready = false) => update((op) => ({ ...op, text: text ?? op.text, status: ready ? "ready" : "done", endedAt: Date.now() })),
      fail: (error: string) => update((op) => ({ ...op, status: "error", error, endedAt: Date.now() })),
    };
  }
  function cancel() {
    active.current?.controller.abort();
    setOperation((op) => op?.status === "running" ? { ...op, status: "cancelled", endedAt: Date.now() } : op);
  }
  return { operation, begin, cancel,
    dismiss: () => setOperation((op) => op?.status === "running" ? op : null),
    replaceText: (text: string) => setOperation((op) => op ? { ...op, text } : op),
  };
}
