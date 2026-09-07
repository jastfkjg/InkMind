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
    generationModel: generation ? user.preferred_llm_model || generation.models[0] || ""
      : builtin ? user.preferred_llm_model || builtin.default_model : "",
    agentProvider: agent ? `custom:${agent.id}` : agentBuiltin ? "builtin:anthropic" : "",
    agentModel: agent ? user.agent_model || agent.models[0] || "" : agentBuiltin ? user.agent_model || agentBuiltin.model : "",
  };
}
