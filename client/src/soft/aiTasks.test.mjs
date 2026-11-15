import test from 'node:test';
import assert from 'node:assert/strict';
import { taskLines } from './aiTasks.js';

test('numbered and bulleted lines become tasks, markdown and citations removed', () => {
  const t = 'Here is a plan:\n1. **Draft** the spec [1]\n2) Review `PRs`\n- Book flights\n* Call bank\nDone.';
  assert.deepEqual(taskLines(t), ['Draft the spec', 'Review PRs', 'Book flights', 'Call bank']);
});
test('plain prose gives nothing', () => assert.deepEqual(taskLines('Just a sentence. And another.'), []));
test('too short or too long lines are skipped, and at most 12 are kept', () => {
  assert.deepEqual(taskLines('- ok\n- ' + 'x'.repeat(200)), []);
  const many = Array.from({ length: 20 }, (_, i) => `- task number ${i}`).join('\n');
  assert.equal(taskLines(many).length, 12);
});
