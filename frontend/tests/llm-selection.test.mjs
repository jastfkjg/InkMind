import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const result = await build({ entryPoints: ['src/utils/llmSelection.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { llmSelection } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const builtins = {
  default: 'qwen', builtin: [{ id: 'qwen', default_model: 'qwen-model' }],
  agent_builtin: { model: 'claude-model' }, custom_llms: [],
};
const empty = { generationProvider: '', generationModel: '', agentProvider: '', agentModel: '' };

test('desktop never selects a built-in even with server defaults or stale preferences', () => {
  assert.deepEqual(llmSelection({ preferred_llm_provider: 'qwen', preferred_llm_model: 'stale', agent_model: 'stale' }, builtins, true), empty);
});
test('missing providers do not leak raw builtin or custom identifiers', () => {
  assert.deepEqual(llmSelection({}, { ...builtins, builtin: [], agent_builtin: null }, false), empty);
  assert.deepEqual(llmSelection({ generation_use_custom: true, generation_custom_llm_id: 42, agent_use_custom: true, agent_custom_llm_id: 42 }, builtins, true), empty);
});
test('desktop preserves configured models; deletion clears the selection', () => {
  const user = { generation_use_custom: true, generation_custom_llm_id: 42, agent_use_custom: true, agent_custom_llm_id: 42, preferred_llm_model: 'writer', agent_model: 'assistant' };
  const info = { ...builtins, custom_llms: [{ id: 42, provider: 'anthropic', models: ['suggestion'] }] };
  assert.deepEqual(llmSelection(user, info, true), { generationProvider: 'custom:42', generationModel: 'writer', agentProvider: 'custom:42', agentModel: 'assistant' });
  assert.deepEqual(llmSelection(user, builtins, true), empty);
});
test('web still selects configured built-ins', () => {
  assert.deepEqual(llmSelection({}, builtins, false), { generationProvider: 'builtin:qwen', generationModel: 'qwen-model', agentProvider: 'builtin:anthropic', agentModel: 'claude-model' });
});
