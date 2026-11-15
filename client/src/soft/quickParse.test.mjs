import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuick } from './quickParse.js';

// Friday 6 November 2026, 10:00
const NOW = new Date(2026, 10, 6, 10, 0, 0);
const ymd = (d) => d && `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

test('weekday, time and length', () => {
  const r = parseQuick('lunch with Sam mon 1pm for an hour', NOW);
  assert.equal(r.title, 'lunch with Sam');
  assert.equal(ymd(r.date), '2026-11-9');
  assert.equal(r.start, '13:00');
  assert.equal(r.end, '14:00');
});

test('tomorrow with a 24 hour time and minutes', () => {
  const r = parseQuick('Design review tomorrow 15:30 for 90 min', NOW);
  assert.equal(r.title, 'Design review');
  assert.equal(ymd(r.date), '2026-11-7');
  assert.equal(r.start, '15:30');
  assert.equal(r.end, '17:00');
});

test('a range takes its end from the text', () => {
  const r = parseQuick('Standup today 9-9:30am', NOW);
  assert.equal(r.start, '09:00');
  assert.equal(r.end, '09:30');
  assert.equal(r.title, 'Standup');
});

test('a time with no day means today', () => {
  const r = parseQuick('call bank at 4pm', NOW);
  assert.equal(ymd(r.date), '2026-11-6');
  assert.equal(r.start, '16:00');
  assert.equal(r.title, 'call bank');
});

test('the same weekday means today, next means a week on', () => {
  assert.equal(ymd(parseQuick('gym fri 6pm', NOW).date), '2026-11-6');
  assert.equal(ymd(parseQuick('gym next fri 6pm', NOW).date), '2026-11-13');
});

test('a date like 12 nov and a bare "at 3" in the afternoon', () => {
  const r = parseQuick('Demo day 12 nov at 3', NOW);
  assert.equal(ymd(r.date), '2026-11-12');
  assert.equal(r.start, '15:00');
  assert.equal(r.title, 'Demo day');
});

test('plain text with nothing to parse is left alone', () => {
  const r = parseQuick('Write the spec', NOW);
  assert.equal(r.title, 'Write the spec');
  assert.equal(r.date, null);
  assert.equal(r.start, null);
  assert.deepEqual(r.chips, []);
});

test('a date in the past rolls to next year', () => {
  assert.equal(ymd(parseQuick('trip 2 nov', NOW).date), '2027-11-2');
});
