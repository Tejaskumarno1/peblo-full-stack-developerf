// Run: cd client && npm test   (node's built-in runner, no extra dependency)
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTask } from './parseTask.js';

const MON = new Date(2026, 9, 12, 10, 0, 0); // Monday 12 Oct 2026, 10:00 local
const FRI = new Date(2026, 9, 16, 10, 0, 0);
const LATE = new Date(2026, 9, 12, 22, 0, 0); // Monday 22:00
const fmt = (d) => d && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const p = (s, now = MON) => parseTask(s, now);
const due = (s, now = MON) => fmt(p(s, now).deadline);

test('the example from the ticket', () => {
  const r = p('Call Rohit next friday 3pm');
  assert.equal(r.text, 'Call Rohit');
  assert.equal(fmt(r.deadline), '2026-10-23 15:00');
  assert.equal(r.allDay, false);
});
test('this/bare friday on a Monday is the coming Friday', () => {
  assert.equal(due('lunch friday'), '2026-10-16 23:59');
  assert.equal(due('lunch this friday'), '2026-10-16 23:59');
  assert.equal(due('lunch on friday'), '2026-10-16 23:59');
});
test('next <weekday> is that day in the next week', () => {
  assert.equal(due('x next monday'), '2026-10-19 23:59');
  assert.equal(due('x next sunday'), '2026-10-25 23:59');
  assert.equal(due('x next wednesday'), '2026-10-21 23:59');
});
test('on a Sunday, next monday is tomorrow (weeks run Monday-Sunday)', () => {
  const sun = new Date(2026, 9, 11, 10);
  assert.equal(due('x next monday', sun), '2026-10-12 23:59'); // weeks run Monday to Sunday, so tomorrow is already next week
});
test('a bare weekday that is today means next week', () => {
  assert.equal(due('x monday'), '2026-10-19 23:59');
  assert.equal(due('x friday', FRI), '2026-10-23 23:59');
});
test('today / tomorrow are all-day unless a time is given', () => {
  const t = p('pay rent today');
  assert.equal(fmt(t.deadline), '2026-10-12 23:59');
  assert.equal(t.allDay, true);
  assert.equal(due('pay rent tomorrow'), '2026-10-13 23:59');
  assert.equal(due('pay rent tmrw'), '2026-10-13 23:59');
  assert.equal(due('pay rent tmr'), '2026-10-13 23:59');
});
test('a task typed "today" is not overdue at once', () => {
  const t = p('pay rent today', new Date(2026, 9, 12, 20, 30));
  assert.ok(t.deadline > new Date(2026, 9, 12, 20, 30));
});
test('tonight is 8 pm', () => {
  assert.equal(due('gym tonight'), '2026-10-12 20:00');
});
test('clock times: am/pm', () => {
  assert.equal(due('a tomorrow 3pm'), '2026-10-13 15:00');
  assert.equal(due('a tomorrow 3 pm'), '2026-10-13 15:00');
  assert.equal(due('a tomorrow 3:30pm'), '2026-10-13 15:30');
  assert.equal(due('a tomorrow 12am'), '2026-10-13 00:00');
  assert.equal(due('a tomorrow 12pm'), '2026-10-13 12:00');
  assert.equal(due('a tomorrow 9AM'), '2026-10-13 09:00');
});
test('clock times: 24 hour and words', () => {
  assert.equal(due('a tomorrow 15:30'), '2026-10-13 15:30');
  assert.equal(due('a tomorrow 07:05'), '2026-10-13 07:05');
  assert.equal(due('a tomorrow noon'), '2026-10-13 12:00');
  assert.equal(due('a tomorrow midnight'), '2026-10-13 00:00');
  assert.equal(due('a tomorrow at 9'), '2026-10-13 09:00');
});
test('the time is removed from the text', () => {
  assert.equal(p('Call Rohit tomorrow at 3pm').text, 'Call Rohit');
  assert.equal(p('Call Rohit 15:30 tomorrow').text, 'Call Rohit');
});
test('a time with no date is today, or tomorrow if already past', () => {
  assert.equal(due('standup at 11am'), '2026-10-12 11:00');
  assert.equal(due('standup at 9am'), '2026-10-13 09:00');
  assert.equal(due('standup 9am', LATE), '2026-10-13 09:00');
});
test('month-name dates', () => {
  assert.equal(due('a Oct 20'), '2026-10-20 23:59');
  assert.equal(due('a oct 20th'), '2026-10-20 23:59');
  assert.equal(due('a 20 October'), '2026-10-20 23:59');
  assert.equal(due('a on 5 dec'), '2026-12-05 23:59');
  assert.equal(due('a Oct 20 6pm'), '2026-10-20 18:00');
});
test('a month-day that has passed rolls to next year', () => {
  assert.equal(due('a Jan 3'), '2027-01-03 23:59');
  assert.equal(due('a Oct 12'), '2026-10-12 23:59'); // today itself stays today
  assert.equal(due('a Oct 11'), '2027-10-11 23:59');
});
test('ISO dates, and impossible dates are left alone', () => {
  assert.equal(due('a 2026-11-02'), '2026-11-02 23:59');
  const bad = p('a 2026-02-31');
  assert.equal(bad.deadline, null);
  assert.equal(bad.text, 'a 2026-02-31');
  assert.equal(p('a Feb 31').deadline, null);
});
test('slash dates are intentionally not parsed (ambiguous)', () => {
  const r = p('read chapter 12/10');
  assert.equal(r.deadline, null);
  assert.equal(r.text, 'read chapter 12/10');
});
test('every date word is removed, the first one wins', () => {
  const r = p('x today ... friday');
  assert.equal(fmt(r.deadline), '2026-10-12 23:59');
  assert.equal(r.text, 'x ...');
});
test('words that merely contain a weekday are not dates', () => {
  for (const s of ['check monday.com board', 'mail friday@example.com', 'read sunday-times']) {
    assert.equal(p(s).deadline, null, s);
    assert.equal(p(s).text, s, s);
  }
  assert.equal(due('see friday.'), '2026-10-16 23:59'); // sentence-final dot is fine
});
test('plain words are untouched', () => {
  const r = p('buy milk');
  assert.deepEqual([r.text, r.deadline, r.allDay], ['buy milk', null, false]);
  assert.equal(p('may the force').deadline, null);
  assert.equal(p('save 5 percent').deadline, null);
});
test('priority', () => {
  assert.equal(p('a !high').priority, 'high');
  assert.equal(p('a !urgent').priority, 'high');
  assert.equal(p('a !low').priority, 'low');
  assert.equal(p('a !med').priority, 'medium');
  assert.equal(p('a').priority, 'medium');
});
test('tags', () => {
  assert.deepEqual(p('a #Family #work_2').tags, ['family', 'work_2']);
  assert.equal(p('a #family').text, 'a');
});
test('everything together', () => {
  const r = p('Call mom tomorrow 6:15pm !high #family');
  assert.deepEqual([r.text, r.priority, r.tags, fmt(r.deadline)], ['Call mom', 'high', ['family'], '2026-10-13 18:15']);
});
test('empty and odd input', () => {
  assert.equal(p('').text, '');
  assert.equal(p('   ').deadline, null);
  assert.equal(parseTask(undefined, MON).text, '');
});
test('month/year boundaries', () => {
  const eoy = new Date(2026, 11, 31, 10);
  assert.equal(due('x tomorrow', eoy), '2027-01-01 23:59');
  assert.equal(due('x next friday', eoy), '2027-01-08 23:59');
});
test('uppercase and extra spaces', () => {
  assert.equal(due('  CALL   Rohit   NEXT   FRIDAY  '), '2026-10-23 23:59');
  assert.equal(p('  CALL   Rohit   NEXT   FRIDAY  ').text, 'CALL Rohit');
});
