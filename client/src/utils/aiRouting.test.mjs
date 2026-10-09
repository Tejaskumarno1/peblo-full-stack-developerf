import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRouting, describeModel, ROUTING_CHOICES } from './aiRouting.js';

test('three routing choices, one of them selected for any stored value', () => {
  assert.deepEqual(ROUTING_CHOICES.map((c) => c.id), ['ollama', 'ask', 'auto']);
  for (const v of ['ollama', 'ask', 'auto', 'openai', 'gemini', undefined, null, 'junk']) {
    assert.ok(ROUTING_CHOICES.some((c) => c.id === normalizeRouting(v)), String(v));
  }
  assert.equal(normalizeRouting('openai'), 'auto');
  assert.equal(normalizeRouting('ask'), 'ask');
});

test('describeModel: local running wins', () => {
  assert.deepEqual(describeModel({ local: { enabled: true, ok: true, chatModel: 'llama3.2' }, cloud: [{ configured: true, model: 'gpt' }], routing: 'auto' }), { kind: 'local', name: 'llama3.2' });
});
test('describeModel: Ollama down, local-only routing warns even with a cloud key', () => {
  assert.equal(describeModel({ local: { enabled: true, ok: false }, cloud: [{ configured: true, model: 'gpt' }], routing: 'ollama' }).kind, 'warn');
});
test('describeModel: Ollama down but a cloud key and auto routing uses the cloud', () => {
  assert.deepEqual(describeModel({ local: { enabled: true, ok: false }, cloud: [{ configured: true, model: 'gpt' }], routing: 'auto' }), { kind: 'cloud', name: 'gpt' });
});
test('describeModel: nothing set up', () => {
  assert.equal(describeModel({}).kind, 'off');
  assert.equal(describeModel(undefined).name, 'No AI set up');
});
