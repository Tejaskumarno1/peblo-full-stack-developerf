// Run: node server/src/mcp/parseTask.test.mjs   (Node 22.18+ strips the TypeScript types itself)
import assert from 'node:assert/strict';
import { parseTaskWords, zonedIso, addDays } from './parseTask.ts';

const T = '2026-11-24'; // a Tuesday
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

t('title, tag, priority and a time with a day', () => {
  assert.deepEqual(parseTaskWords('revise BCNF tomorrow 5pm !high #exams', T), { text: 'revise BCNF', tags: ['exams'], priority: 'high', date: '2026-11-25', time: '17:00' });
});
t('tonight means today at 18:30', () => {
  const p = parseTaskWords('call mom tonight', T);
  assert.equal(p.date, T); assert.equal(p.time, '18:30'); assert.equal(p.text, 'call mom');
});
t('a weekday is the next one (same day counts as today, "next" skips a week)', () => {
  assert.equal(parseTaskWords('report fri', T).date, '2026-11-27');
  assert.equal(parseTaskWords('standup tue', T).date, T);
  assert.equal(parseTaskWords('standup next tue', T).date, '2026-12-01');
});
t('a time alone means today; 24-hour times work', () => {
  assert.deepEqual([parseTaskWords('lunch at 1:30pm', T).date, parseTaskWords('lunch at 1:30pm', T).time], [T, '13:30']);
  assert.equal(parseTaskWords('standup 09:15', T).time, '09:15');
});
t('12am and 12pm', () => {
  assert.equal(parseTaskWords('x 12am', T).time, '00:00');
  assert.equal(parseTaskWords('x 12pm', T).time, '12:00');
});
t('plain words with tags and !low keep the title clean', () => {
  const p = parseTaskWords('plain task #a #b !low', T);
  assert.deepEqual([p.text, p.tags, p.priority, p.date], ['plain task', ['a', 'b'], 'low', undefined]);
});
t('nothing left after parsing gives an empty title', () => {
  assert.equal(parseTaskWords('tomorrow !high', T).text, '');
});
t('addDays crosses month and year ends', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});
t('zonedIso: India has no daylight saving, New York does', () => {
  assert.equal(zonedIso('2026-11-25', '17:00', 'Asia/Kolkata'), '2026-11-25T11:30:00.000Z');
  assert.equal(zonedIso('2026-07-01', '09:00', 'America/New_York'), '2026-07-01T13:00:00.000Z');
  assert.equal(zonedIso('2026-12-01', '09:00', 'America/New_York'), '2026-12-01T14:00:00.000Z');
});
t('zonedIso: an unknown zone falls back to UTC instead of throwing', () => {
  assert.equal(zonedIso('2026-11-25', '17:00', 'Not/AZone'), '2026-11-25T17:00:00.000Z');
});
console.log(`${n} passed`);
