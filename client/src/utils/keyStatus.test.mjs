import test from 'node:test';
import assert from 'node:assert/strict';
import { unreadableKeyMessage } from './keyStatus.js';

test('no message when every key reads fine', () => {
  assert.equal(unreadableKeyMessage({}), '');
  assert.equal(unreadableKeyMessage(undefined), '');
  assert.equal(unreadableKeyMessage({ unreadableKeys: [] }), '');
});
test('names the keys that cannot be read', () => {
  assert.match(unreadableKeyMessage({ unreadableKeys: ['openAiKey'] }), /OpenAI key can't be read/);
  assert.match(unreadableKeyMessage({ unreadableKeys: ['openAiKey', 'geminiKey'] }), /OpenAI and Gemini key/);
  assert.equal(unreadableKeyMessage({ unreadableKeys: ['groqKey'] }), '');
});
