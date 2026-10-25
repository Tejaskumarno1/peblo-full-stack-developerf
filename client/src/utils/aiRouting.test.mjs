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

test('hosted web app: every stored choice means the cloud keys, and local AI is ignored', () => {
  for (const v of ['ollama', 'ask', 'auto', undefined]) assert.equal(normalizeRouting(v, true), 'auto', String(v));
  assert.equal(normalizeRouting('ollama'), 'ollama'); // the desktop app still honours it
  const cloud = [{ configured: true, model: 'gpt' }];
  assert.deepEqual(describeModel({ hosted: true, routing: 'ollama', local: { enabled: true, ok: false }, cloud }), { kind: 'cloud', name: 'gpt' });
  assert.deepEqual(describeModel({ hosted: true, routing: 'ask', cloud: [{ configured: false, model: 'gpt' }] }), { kind: 'off', name: 'No AI set up' });
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
assert.deepEqual(describeModel({ aiOff: true, local: { enabled: true, ok: true, chatModel: 'llama3.2' }, cloud: [{ configured: true, model: 'gpt' }], routing: 'auto' }), { kind: 'off', name: 'AI is off' });
  assert.equal(describeModel(undefined).name, 'No AI set up');
});
