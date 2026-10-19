import test from 'node:test';
import assert from 'node:assert/strict';
import { tasksToIcs, tasksToCsv, parseTasksCsv, parseCsv, foldLine } from './taskExport.js';
import { crc32, zipBytes } from './zip.js';

const NOW = new Date(2026, 9, 19, 9, 0, 0);

test('ics: all-day, timed and undated tasks', () => {
  const ics = tasksToIcs([
    { id: 'a', text: 'Submit, lab; file', deadline: new Date(2026, 9, 21, 23, 59).toISOString(), priority: 'high', todoTags: ['sql'] },
    { id: 'b', text: 'Viva', deadline: new Date(2026, 9, 22, 23, 59).toISOString(), startTime: '10:00', endTime: '11:30' },
    { id: 'c', text: 'Someday', deadline: null, completed: true },
  ], NOW);
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261021\r\nDTEND;VALUE=DATE:20261022/);
  assert.match(ics, /SUMMARY:Submit\\, lab\\; file/);
  assert.match(ics, /DTSTART:20261022T100000\r\nDTEND:20261022T113000/);
  assert.match(ics, /BEGIN:VTODO[\s\S]*STATUS:COMPLETED[\s\S]*END:VTODO/);
  assert.match(ics, /PRIORITY:1/);
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
});

test('ics lines are folded at 75 characters', () => {
  const folded = foldLine('SUMMARY:' + 'x'.repeat(200));
  for (const l of folded.split('\r\n')) assert.ok(l.length <= 75);
});

test('csv: quotes, commas and formula cells are made safe', () => {
  const csv = tasksToCsv([{ text: '=SUM(A1)', completed: true, priority: 'low', deadline: new Date(2026, 9, 21, 23, 59).toISOString(), todoTags: ['a', 'b'] }, { text: 'Say "hi", ok' }]);
  assert.match(csv, /^﻿Task,Done,Priority/);
  assert.match(csv, /'=SUM\(A1\),yes,low,2026-10-21,,,a b,/);
  assert.match(csv, /"Say ""hi"", ok",no,medium/);
});

test('csv round trip, with errors named by row', () => {
  const src = tasksToCsv([{ text: 'Read ch 4', priority: 'high', deadline: new Date(2026, 9, 21, 23, 59).toISOString(), todoTags: ['dbms'], startTime: '09:00', endTime: '10:00' }]);
  const back = parseTasksCsv(src);
  assert.equal(back.errors.length, 0);
  assert.equal(back.tasks[0].text, 'Read ch 4');
  assert.equal(back.tasks[0].priority, 'high');
  assert.deepEqual(back.tasks[0].tags, ['dbms']);
  assert.equal(back.tasks[0].startTime, '09:00');
  const bad = parseTasksCsv('Task,Priority,Due date\nok,high,2026-10-21\n,low,\nnope,urgent,\nlate,low,21/10/2026\n');
  assert.equal(bad.tasks.length, 1);
  assert.equal(bad.errors.length, 3);
  assert.match(bad.errors[0], /Row 3/);
  assert.equal(parseTasksCsv('foo,bar\n1,2').errors.length, 1);
  assert.deepEqual(parseCsv('a,"b,\nc",d\r\n1,2,3'), [['a', 'b,\nc', 'd'], ['1', '2', '3']]);
});

test('zip: crc32 of a known string, signatures and duplicate names', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const z = zipBytes([{ name: 'a.md', data: 'hello' }, { name: 'a.md', data: 'again' }, { name: 'dir\\b.csv', data: 'x' }]);
  assert.equal(z[0], 0x50); assert.equal(z[1], 0x4b); // PK
  const text = Buffer.from(z).toString('latin1');
  assert.ok(text.includes('a (2).md'));
  assert.ok(text.includes('dir/b.csv'));
  // end-of-directory record says 3 entries
  const eocd = z.length - 22;
  assert.equal(z[eocd], 0x50);
  assert.equal(z[eocd + 10], 3);
});
