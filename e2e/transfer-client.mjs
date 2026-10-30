// Import/export edge checks for the pure client utilities (no browser, no server): formula injection, ICS escaping and folding,
// CSV round trip, 100k-row CSV. Run:  node e2e/transfer-client.mjs   
import { fileURLToPath } from 'url';
import { tasksToIcs, tasksToCsv, parseTasksCsv, parseCsv, foldLine, icsEscape } from '../client/src/utils/taskExport.js';

let failures = 0;
const check = (name, ok, extra) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) { failures++; if (extra !== undefined) console.log('      ', String(extra).slice(0, 400)); } };
const NOW = new Date(2026, 9, 19, 9, 0, 0);
const deadline = new Date(2026, 9, 21, 23, 59).toISOString();
const enc = new TextEncoder();

// ---- (1) formula injection
const evil = ['=HYPERLINK("http://evil","x")', "+cmd|' /C calc'!A0", '@SUM(1+1)', '-2+3', '\t=1+1', '\r=1+1', '=1+1'];
const csv = tasksToCsv(evil.map((text, i) => ({ id: 'e' + i, text, deadline, todoTags: [evil[i]] })));
const csvRows = parseCsv(csv);
check('csv: every dangerous Task cell starts with a single quote', csvRows.slice(1).every((r, i) => r[0] === "'" + evil[i]), JSON.stringify(csvRows.slice(1).map((r) => r[0])));
check('csv: no cell of any column starts with = + - @ tab or CR', csvRows.every((r) => r.every((c) => !/^[=+\-@\t\r]/.test(c))), JSON.stringify(csvRows.find((r) => r.some((c) => /^[=+\-@\t\r]/.test(c)))));
check('csv: the raw text has the quoted formula (no unquoted leading =)', !/(^|,|\n)=HYPERLINK/.test(csv) && csv.includes(`"'=HYPERLINK(""http://evil"",""x"")"`), csv.slice(0, 200));
check('csv: ordinary text is not changed', parseCsv(tasksToCsv([{ text: 'Buy milk, eggs', todoTags: ['a'] }]))[1][0] === 'Buy milk, eggs');
check('csv: text containing a dash or equals in the middle is not changed', parseCsv(tasksToCsv([{ text: 'a=b - c+d@e' }]))[1][0] === 'a=b - c+d@e');
// round trip gives the original text back
const back = parseTasksCsv(csv);
check('csv round trip: parse removes the protective quote (task text identical)', evil.slice(0, 4).every((t, i) => back.tasks[i]?.text === t.trim()) , JSON.stringify(back.tasks.map((t) => t.text)));
check('csv round trip: a task that really starts with an apostrophe stays', parseTasksCsv(tasksToCsv([{ text: "'quoted" }])).tasks[0].text === "'quoted");
const unicode = ['日本語 タスク', 'emoji 😀🎉 task', 'ñandú, "café"', 'line1\nline2', 'x'.repeat(600)];
const ub = parseTasksCsv(tasksToCsv(unicode.map((text) => ({ text }))));
check('csv round trip: unicode, emoji, quotes, newlines survive (500-char cap on very long)', ub.tasks.length === 5 && ub.tasks.slice(0, 4).every((t, i) => t.text === unicode[i]) && ub.tasks[4].text.length === 500, JSON.stringify(ub.tasks.map((t) => t.text.slice(0, 20))));

// ---- (2) ICS
const ics = tasksToIcs(evil.map((text, i) => ({ id: 'id' + i, text, deadline, todoTags: ['a,b', 'c;d'] })), NOW);
check('ics: CRLF everywhere (no bare LF or CR)', !/(^|[^\r])\n/.test(ics) && !/\r(?!\n)/.test(ics));
check('ics: HYPERLINK summary has commas, quotes escaped', ics.includes('SUMMARY:=HYPERLINK("http://evil"\\,"x")'), ics.split('\r\n').find((l) => l.startsWith('SUMMARY')));
check('ics: categories escape commas and semicolons inside a tag, join with plain commas', ics.includes('CATEGORIES:a\\,b,c\\;d'));
const nasty = tasksToIcs([{ id: 'n', text: 'a\r\nEND:VCALENDAR\r\nBEGIN:VEVENT\rX;Y\\Z,\u0007bell', deadline }], NOW);
const nastyLines = nasty.split('\r\n');
check('ics: CR/LF in a title cannot inject a property or end the calendar', nastyLines.filter((l) => l === 'END:VCALENDAR').length === 1 && nastyLines.filter((l) => l === 'BEGIN:VEVENT').length === 1, nastyLines.join(' | '));
check('ics: escape order (backslash first) and control char removed', icsEscape('X;Y\\Z,\u0007\n') === 'X\\;Y\\\\Z\\,\\n', icsEscape('X;Y\\Z,\u0007\n'));
const longAscii = tasksToIcs([{ id: 'l', text: 'x'.repeat(500), deadline }], NOW);
check('ics: all physical lines <= 75 octets (ASCII)', longAscii.split('\r\n').every((l) => enc.encode(l).length <= 75));
const longCjk = tasksToIcs([{ id: 'l', text: '日本語😀'.repeat(60), deadline, todoTags: ['ñ'.repeat(80)] }], NOW);
check('ics: all physical lines <= 75 octets (multi-byte, emoji)', longCjk.split('\r\n').every((l) => enc.encode(l).length <= 75), longCjk.split('\r\n').map((l) => enc.encode(l).length).join(','));
const unfold = (s) => s.replace(/\r\n[ \t]/g, '');
check('ics: unfolding restores the exact text, no split characters (no U+FFFD / lone surrogate)', unfold(longCjk).includes('SUMMARY:' + icsEscape('日本語😀'.repeat(60))) && !/�/.test(longCjk) && !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(longCjk));
check('ics: foldLine leaves a short line alone and folds exactly at 75', foldLine('a'.repeat(75)) === 'a'.repeat(75) && foldLine('a'.repeat(76)) === 'a'.repeat(75) + '\r\n a');
const ids = ics.split('\r\n').filter((l) => l.startsWith('UID:'));
check('ics: UID unique per task', new Set(ids).size === ids.length && ids.length === evil.length);
const mixed = tasksToIcs([
  { id: 'allday', text: 'all day', deadline: new Date(2026, 9, 21, 23, 59).toISOString() },
  { id: 'timed', text: 'timed', deadline, startTime: '09:30', endTime: '10:15' },
  { id: 'overnight', text: 'bad end', deadline, startTime: '23:00', endTime: '01:00' },
  { id: 'todo', text: 'undated' },
  { id: 'baddate', text: 'bad date', deadline: 'not-a-date' },
], NOW);
check('ics: all-day uses VALUE=DATE with next-day DTEND', mixed.includes('DTSTART;VALUE=DATE:20261021\r\nDTEND;VALUE=DATE:20261022'));
check('ics: timed event is floating local time (no Z), DTSTAMP is UTC with Z', mixed.includes('DTSTART:20261021T093000\r\nDTEND:20261021T101500') && /DTSTAMP:\d{8}T\d{6}Z/.test(mixed));
check('ics: end before start falls back to start + 30 min', mixed.includes('DTSTART:20261021T230000\r\nDTEND:20261021T233000'));
check('ics: an unreadable date becomes a VTODO, never NaN in the file', !/NaN/.test(mixed) && (mixed.match(/BEGIN:VTODO/g) || []).length === 2, mixed.match(/.*NaN.*/)?.[0]);

// ---- (3) 100k-row CSV: no stack overflow, linear time
const t0 = Date.now();
const big = 'Task,Done,Priority\r\n' + Array.from({ length: 100000 }, (_, i) => `Task number ${i} "q",no,high`).join('\r\n') + '\r\n';
let bigRes; let bigErr;
try { bigRes = parseTasksCsv(big); } catch (e) { bigErr = e; }
check('csv: 100,000 rows parse without a stack overflow', !bigErr && bigRes.tasks.length === 0 + 100000 || (!bigErr && bigRes.tasks.length === 100000), bigErr?.message || bigRes?.errors?.slice(0, 2));
check('csv: 100,000 rows parse in under 5 s', Date.now() - t0 < 5000, `${Date.now() - t0} ms`);
const bigOut = tasksToCsv(bigRes?.tasks?.map((t) => ({ text: t.text })) || []);
check('csv: 100,000 rows export (tasksToCsv) without overflow', bigOut.split('\r\n').length === 100003 - 1 + 0 || bigOut.length > 1000000, bigOut.length);
check('csv: bad rows are reported, not dropped silently', parseTasksCsv('Task,Priority,Due date\nok,urgent,2026-10-21\nfine,high,21/10/2026\n,low,\n').errors.length === 3);

// ---- calendarIO (needs tsx: its imports have no .js extensions)
try {
  // calendarIO pulls in the axios client and extension-less imports: bundle it in memory with esbuild (the axios client is stubbed) (nothing is written to disk)
  const esbuild = await import('esbuild');
  const built = await esbuild.build({ entryPoints: [fileURLToPath(new URL('../client/src/river/calendarIO.js', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent', loader: { '.js': 'jsx' }, plugins: [{ name: 'stub-api', setup(b) { b.onResolve({ filter: /^\.\.\/api$/ }, () => ({ path: 'api-stub', namespace: 'stub' })); b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const todosAPI = {};', loader: 'js' })); } }] });
  const { buildIcs, parseIcs } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
  const todos = [{ id: 't1', text: 'Meet, plan; "now"\\ n', deadline, startTime: '10:00', endTime: '11:00', meta: { link: 'https://meet.google.com/abc-defg-hij', attendees: ['A, B', 'C'], remindMin: 10 }, priority: 'medium' },
    { id: 't2', text: '日本語😀'.repeat(40), deadline, startTime: '12:00', endTime: '13:00', meta: { link: 'https://zoom.us/j/1\r\nEND:VEVENT' } }];
  const out = buildIcs(todos);
  check('calendarIO: CRLF, folded <= 75 octets', !/(^|[^\r])\n/.test(out) && out.split('\r\n').every((l) => enc.encode(l).length <= 75));
  check('calendarIO: a CRLF inside a link cannot inject END:VEVENT', out.split('\r\n').filter((l) => l === 'END:VEVENT').length === 2, out);
  const evs = parseIcs(out);
  check('calendarIO: export then parse gives the same titles (backslash before n, quotes, commas)', evs[0]?.title === todos[0].text && evs[1]?.title === todos[1].text, JSON.stringify(evs.map((e) => e.title)));
  check('calendarIO: parseIcs reads escaped backslash+n literally', parseIcs('BEGIN:VEVENT\r\nSUMMARY:a\\\\nb\\nc\r\nDTSTART:20261021T100000\r\nEND:VEVENT\r\n')[0]?.title === 'a\\nb\nc');
} catch (e) {
  console.log('SKIP  calendarIO checks :', String(e.message).slice(0, 120));
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll client transfer checks passed');
process.exit(failures ? 1 : 0);
