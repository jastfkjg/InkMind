import type { LlmProvidersResponse, User } from "@/types";

/** Only display selections that are actually available to this user/runtime. */
export function llmSelection(user: User, info: LlmProvidersResponse, desktop: boolean) {
  const generation = user.generation_use_custom
    ? info.custom_llms.find((item) => item.id === user.generation_custom_llm_id)
    : undefined;
  const agent = user.agent_use_custom
    ? info.custom_llms.find((item) => item.id === user.agent_custom_llm_id
      && item.protocol === "anthropic")
    : undefined;
  const builtin = !desktop && !user.generation_use_custom
    ? info.builtin.find((item) => item.id === (user.preferred_llm_provider || info.default))
    : undefined;
  const agentBuiltin = !desktop && !user.agent_use_custom ? info.agent_builtin : null;
  return {
    generationProvider: generation ? `custom:${generation.id}` : builtin ? `builtin:${builtin.id}` : "",
    generationModel: generation ? user.preferred_llm_model || generation.default_model || generation.models[0] || ""
      : builtin ? user.preferred_llm_model || builtin.default_model : "",
    agentProvider: agent ? `custom:${agent.id}` : agentBuiltin ? "builtin:anthropic" : "",
    agentModel: agent ? user.agent_model || agent.default_model || agent.models[0] || "" : agentBuiltin ? user.agent_model || agentBuiltin.model : "",
  };
}

/** Selecting a connection starts from its default, not a previous role override.
 * Persist null for configured defaults so later connection edits remain effective.
 */
export function llmProviderSelection(info: LlmProvidersResponse | null, value: string, role: "generation" | "agent") {
  if (value.startsWith("custom:")) {
    const custom = info?.custom_llms.find(item => item.id === Number(value.slice(7)));
    const configured = custom?.default_model?.trim();
    const model = configured || custom?.models?.[0] || "";
    return { model, savedModel: configured ? null : model || null };
  }
  const builtin = info?.builtin.find(item => item.id === value.replace(/^builtin:/, ""));
  const model = role === "agent" ? info?.agent_builtin?.model || "" : builtin?.default_model || "";
  return { model, savedModel: model || null };
}
