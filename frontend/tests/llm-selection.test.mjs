import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const result = await build({ entryPoints: ['src/utils/llmSelection.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { llmSelection, llmProviderSelection } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
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
  const info = { ...builtins, custom_llms: [{ id: 42, provider: 'qwen', protocol: 'anthropic', models: ['suggestion'] }] };
  assert.deepEqual(llmSelection(user, info, true), { generationProvider: 'custom:42', generationModel: 'writer', agentProvider: 'custom:42', agentModel: 'assistant' });
  assert.deepEqual(llmSelection(user, builtins, true), empty);
});
test('web still selects configured built-ins', () => {
  assert.deepEqual(llmSelection({}, builtins, false), { generationProvider: 'builtin:qwen', generationModel: 'qwen-model', agentProvider: 'builtin:anthropic', agentModel: 'claude-model' });
});

test('assistant availability follows protocol, not brand, on desktop and web', () => {
  for (const desktop of [true, false]) {
    const user = { agent_use_custom: true, agent_custom_llm_id: 42, agent_model: 'custom-unlisted-model' };
    const info = { ...builtins, custom_llms: [{ id: 42, provider: 'anthropic', protocol: 'openai', models: [] }] };
    assert.equal(llmSelection(user, info, desktop).agentProvider, '');
    info.custom_llms[0] = { id: 42, provider: 'qwen', protocol: 'anthropic', models: [] };
    assert.equal(llmSelection(user, info, desktop).agentProvider, 'custom:42');
    assert.equal(llmSelection(user, info, desktop).agentModel, 'custom-unlisted-model');
  }
});


test('connection defaults apply only when a per-role model is absent', () => {
  const user = { generation_use_custom: true, generation_custom_llm_id: 42, agent_use_custom: true, agent_custom_llm_id: 42 };
  const info = { ...builtins, custom_llms: [{ id: 42, provider: 'qwen', protocol: 'anthropic', default_model: 'custom-default', models: ['old-preset'] }] };
  assert.equal(llmSelection(user, info, true).generationModel, 'custom-default');
  assert.equal(llmSelection(user, info, true).agentModel, 'custom-default');
  assert.equal(llmSelection({ ...user, agent_model: 'override' }, info, true).agentModel, 'override');
});


test('selecting a Qwen connection inherits its DeepSeek default instead of its first preset', () => {
  const info = { ...builtins, custom_llms: [{ id: 42, provider: 'qwen', protocol: 'anthropic', default_model: 'deepseek-v4-pro', models: ['qwen3-max'] }] };
  for (const desktop of [true, false]) {
    for (const role of ['generation', 'agent']) {
      const selection = llmProviderSelection(info, 'custom:42', role);
      assert.deepEqual(selection, { model: 'deepseek-v4-pro', savedModel: null });
      const user = { generation_use_custom: true, generation_custom_llm_id: 42, preferred_llm_model: selection.savedModel,
        agent_use_custom: true, agent_custom_llm_id: 42, agent_model: selection.savedModel };
      assert.equal(llmSelection(user, info, desktop)[role + 'Model'], 'deepseek-v4-pro');
      const edited = { ...info, custom_llms: [{ ...info.custom_llms[0], default_model: 'new-default' }] };
      assert.equal(llmSelection(user, edited, desktop)[role + 'Model'], 'new-default');
    }
  }
});

test('reselecting clears stale role overrides but explicit later overrides are preserved', () => {
  const info = { ...builtins, custom_llms: [{ id: 42, provider: 'qwen', default_model: 'deepseek-v4-pro', models: ['qwen3-max'] }] };
  const user = { generation_use_custom: true, generation_custom_llm_id: 42, preferred_llm_model: 'qwen3-max' };
  const { savedModel } = llmProviderSelection(info, 'custom:42', 'generation');
  assert.equal(llmSelection({ ...user, preferred_llm_model: savedModel }, info, true).generationModel, 'deepseek-v4-pro');
  assert.equal(llmSelection({ ...user, preferred_llm_model: 'my-other-model' }, info, true).generationModel, 'my-other-model');
});

test('legacy connections without defaults and built-ins retain their fallback models', () => {
  const info = { ...builtins, custom_llms: [{ id: 42, models: ['legacy-model'] }] };
  assert.deepEqual(llmProviderSelection(info, 'custom:42', 'generation'), { model: 'legacy-model', savedModel: 'legacy-model' });
  assert.deepEqual(llmProviderSelection(info, 'builtin:qwen', 'generation'), { model: 'qwen-model', savedModel: 'qwen-model' });
  assert.deepEqual(llmProviderSelection(info, 'builtin:anthropic', 'agent'), { model: 'claude-model', savedModel: 'claude-model' });
  assert.deepEqual(llmProviderSelection(null, 'custom:42', 'generation'), { model: '', savedModel: null });
});
