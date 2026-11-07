// Calendar sync: reading other calendars by .ics link, the subscribe feed and the free-time link.
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { boot, REPO } from './lib.mjs';
process.env.PEBLO_ALLOW_PRIVATE_FETCH = '1'; // the test calendar lives on 127.0.0.1
const day = (n) => { const d = new Date(Date.now() + n * 86400000); return d.toISOString().slice(0, 10).replace(/-/g, ''); };
const ICS = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN',
  'BEGIN:VEVENT', 'UID:a1', `DTSTART:${day(2)}T090000Z`, `DTEND:${day(2)}T100000Z`, 'SUMMARY:Dentist\\, Dr Rao', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:a2', `DTSTART;VALUE=DATE:${day(3)}`, `DTEND;VALUE=DATE:${day(4)}`, 'SUMMARY:Offsite', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:a3', `DTSTART;TZID=Asia/Kolkata:${day(5)}T100000`, `DTEND;TZID=Asia/Kolkata:${day(5)}T110000`, 'RRULE:FREQ=WEEKLY;COUNT=3', 'SUMMARY:Standup', 'END:VEVENT',
  'END:VCALENDAR', ''].join('\r\n');
const srv = http.createServer((req, res) => { if (req.url === '/cal.ics') { res.writeHead(200, { 'Content-Type': 'text/calendar' }); res.end(ICS); } else if (req.url === '/redir') { res.writeHead(302, { Location: '/cal.ics' }); res.end(); } else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>not a calendar</html>'); } });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const host = `http://127.0.0.1:${srv.address().port}`;
const b = await boot();
const ok = (c, m, x) => b.check(m, !!c, x);
try {
  const { parseIcs } = await import(pathToFileURL(path.join(REPO, process.env.PEBLO_SERVER_DIST || 'dist', 'server', 'services', 'icsFeeds.js')).href);
  const ev = parseIcs(ICS, Date.now() - 86400000, Date.now() + 90 * 86400000);
  ok(ev.length === 5, 'parser reads 1 timed + 1 all-day + 3 repeats of the weekly one', ev.length);
  ok(ev.find((e) => e.uid.startsWith('a1'))?.title === 'Dentist, Dr Rao', 'escaped commas are unescaped');
  ok(ev.find((e) => e.allDay)?.end > ev.find((e) => e.allDay)?.start, 'all-day events keep their dates');
  const st = ev.filter((e) => e.uid.startsWith('a3')).map((e) => e.start);
  ok(st.length === 3 && new Date(st[0]).getUTCHours() === 4 && new Date(st[0]).getUTCMinutes() === 30, 'TZID Asia/Kolkata 10:00 is 04:30 UTC', st[0]);

  const bad = await b.api('POST', '/api/calendar-sync/feeds', { url: `${host}/page` });
  ok(bad.error, 'a link that is not a calendar is refused with a reason', JSON.stringify(bad));
  const none = await b.api('POST', '/api/calendar-sync/feeds', { url: 'file:///etc/passwd' });
  ok(none.error, 'a non-web link is refused', JSON.stringify(none));
  const add = await b.api('POST', '/api/calendar-sync/feeds', { url: `${host}/redir`, name: 'Work', color: 'mint' });
  ok(add.feed?.count === 5 && add.feed?.name === 'Work', 'a calendar link is added (through a redirect) and read at once', JSON.stringify(add));
  const list = await b.api('GET', '/api/calendar-sync');
  ok(list.feeds?.length === 1 && list.share?.feedOn === false && list.share?.freeOn === false, 'sharing starts off', JSON.stringify(list.share));
  const evs = await b.api('GET', `/api/calendar-sync/events?from=${new Date().toISOString().slice(0, 10)}&to=${new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)}`);
  ok(evs.events?.length === 5 && evs.events[0].color === 'mint', 'events come back with the link colour', evs.events?.length);
  await b.api('PATCH', `/api/calendar-sync/feeds/${add.feed.id}`, { enabled: false });
  const off = await b.api('GET', '/api/calendar-sync/events');
  ok(off.events?.length === 0, 'a switched-off link adds nothing');
  await b.api('PATCH', `/api/calendar-sync/feeds/${add.feed.id}`, { enabled: true });

  // our own links
  const pub = await fetch(list.share.feedUrl);
  ok(pub.status === 404, 'subscribe link is dead while it is off');
  await b.api('POST', '/api/todos', { text: 'Write report', deadline: new Date(Date.now() + 86400000).toISOString(), startTime: '14:00', endTime: '15:30', timezone: 'UTC' });
  const on = await b.api('PUT', '/api/calendar-sync/share', { feedOn: true, freeOn: true });
  const ics = await (await fetch(on.share.feedUrl)).text();
  ok(/BEGIN:VCALENDAR/.test(ics) && /SUMMARY:Write report/.test(ics) && /DTSTART/.test(ics), 'subscribe link serves the task as iCal');
  const free = await (await fetch(on.share.freeUrl)).json();
  ok(Array.isArray(free.busy) && free.busy.length >= 1 && !JSON.stringify(free).includes('Write report') && !JSON.stringify(free).includes('Dentist'), 'free time shows busy blocks and no titles', JSON.stringify(free).slice(0, 200));
  const renewed = await b.api('PUT', '/api/calendar-sync/share', { renew: 'feed' });
  ok(renewed.share.feedUrl !== on.share.feedUrl && (await fetch(on.share.feedUrl)).status === 404, 'a new link kills the old one');
  const tokenBlock = await fetch(b.base + '/api/calendar-sync', { headers: { Authorization: 'Bearer pbl_' + 'x'.repeat(30) } });
  ok(tokenBlock.status === 401 || tokenBlock.status === 403, 'AI access tokens cannot reach calendar sync', tokenBlock.status);

  // the page
  await b.page.goto(b.base + '/calendar/sync', { waitUntil: 'networkidle' });
  await b.page.waitForTimeout(800);
  await b.page.screenshot({ path: 'D:\\Peblo\\_shots\\calsync.png' }).catch(() => {});
  ok(await b.page.getByRole('heading', { name: 'Calendar links' }).isVisible(), 'sync page opens');
  ok(await b.page.locator('[data-feed-row="Work"]').isVisible(), 'the link is listed');
  await b.page.goto(b.base + '/calendar', { waitUntil: 'networkidle' });
  await b.page.getByRole('tab', { name: 'Month' }).click().catch(() => {});
  ok(await b.page.locator('[data-feed-layer="Work"]').isVisible(), 'the link shows as a layer on the calendar');
  const del = await b.api('DELETE', `/api/calendar-sync/feeds/${add.feed.id}`);
  ok(del.ok, 'a link can be removed');
} catch (e) { ok(false, 'ics-feeds ran without crashing', e?.stack || e); }
srv.close();
await b.finish();
