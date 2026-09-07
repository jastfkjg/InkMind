import axios from "axios";
import type { LlmProbeMode, LlmProbeResult } from "@/api/client";

/** Transport failures are from InkMind, not the model provider. Never expose request config. */
export function probeTransportError(error: unknown, mode: LlmProbeMode): LlmProbeResult {
  const code = axios.isAxiosError(error) ? error.response?.status : undefined;
  let status = "backend_unavailable";
  if (code === 404 || code === 405) status = "backend_outdated";
  else if (code === 401 || code === 403) status = "session_expired";
  else if (code === 422) status = "backend_validation";
  else if (code && code >= 500) status = "backend_error";
  else if (axios.isAxiosError(error) && ["ECONNABORTED", "ETIMEDOUT"].includes(error.code || "")) status = "backend_timeout";
  return { mode, status, models: [], http_status: code ?? null };
}
