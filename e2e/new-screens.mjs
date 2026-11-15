// Notification centre, grouped search, holidays, event reminders + travel time, Home widgets (mockups: NotifCentre, GroupedSearch, CalHolidays, EventReminders, HomeWidgets).
import { boot } from './lib.mjs';
const b = await boot({ noteLayout: 'cards' });
const { page } = b; const ok = (c, m) => b.check(m, !!c);
const SH = 'D:/Peblo/_shots/new';
const iso = (d) => d.toISOString();
try {
  // ---------- seed ----------
  const now = new Date();
  const todayAt = (h, m = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  const soon = new Date(now.getTime() + 25 * 60000); const hh = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const end = new Date(soon.getTime() + 3600000);
  const sameDayMeeting = soon.getDate() === now.getDate() && end.getDate() === now.getDate();
  await b.api('POST', '/api/notes', { title: 'Orbit stories', content: '<p>Sprint 12 stories and QA notes for the Orbit release</p>', tags: ['orbit'] });
  await b.api('POST', '/api/notes', { title: 'Pi planning', content: '<p>Orbit mobile estimates</p>', tags: ['work'] });
  await b.api('POST', '/api/todos', { text: 'Write Orbit release notes', priority: 'high', tags: ['orbit'], deadline: iso(todayAt(9)) });
  await b.api('POST', '/api/todos', { text: 'Pay hostel fee', priority: 'medium', tags: [], deadline: iso(todayAt(9)) });
  if (sameDayMeeting) await b.api('POST', '/api/todos', { text: 'Orbit weekly sync', priority: 'medium', tags: [], deadline: iso(todayAt(0)), startTime: hh(soon), endTime: hh(end), meta: { link: 'https://meet.google.com/abc-defg-hij' } });

  // ---------- notification centre ----------
  await page.goto(`${b.base}/`); await page.waitForTimeout(1500);
  ok(await page.getByTestId('soft-bell').count() === 1, 'header has the notifications bell');
  await page.getByTestId('soft-bell').click(); await page.waitForTimeout(1200);
  ok(page.url().endsWith('/notifications'), 'bell opens /notifications');
  ok(await page.getByRole('heading', { name: 'Notifications' }).count() === 1, 'Notifications heading');
  const rows = await page.getByTestId('notif-row').count();
  ok(rows >= 2, `lists due tasks as notifications (${rows})`);
  ok(await page.getByTestId('notif-row').filter({ hasText: 'Pay hostel fee is due today' }).count() === 1, 'task due today shows as a notification');
  if (sameDayMeeting) ok(await page.getByTestId('notif-row').filter({ hasText: 'Orbit weekly sync' }).getByRole('button', { name: 'Join' }).count() === 1, 'meeting with a link has a Join button');
  ok(await page.getByTestId('notif-new').count() === 1, 'shows "n new" pill');
  await page.screenshot({ path: `${SH}-notif.png` });
  await page.getByRole('radio', { name: 'Tasks', exact: true }).click(); await page.waitForTimeout(300);
  ok(await page.locator('[data-testid=notif-row][data-kind=meeting]').count() === 0 && await page.locator('[data-testid=notif-row][data-kind=task]').count() >= 2, 'Tasks filter shows only tasks');
  await page.getByRole('radio', { name: 'All', exact: true }).click();
  await page.getByTestId('notif-read-all').click(); await page.waitForTimeout(600);
  ok(await page.getByTestId('notif-new').count() === 0, 'Mark all read clears the new pill');
  ok(await page.getByRole('switch', { name: 'Quiet hours' }).count() === 1, 'quiet hours switch');
  await page.getByRole('switch', { name: 'Quiet hours' }).click(); await page.waitForTimeout(300);
  ok(await page.locator('input[type=time]').count() === 2, 'quiet hours shows From and To');
  await page.screenshot({ path: `${SH}-notif-read.png` });

  // ---------- grouped search ----------
  await page.goto(`${b.base}/tasks`); await page.waitForTimeout(1000);
  await page.keyboard.press('Control+k'); await page.waitForTimeout(500);
  await page.locator('.cmd-input').fill('orbit'); await page.waitForTimeout(1400);
  ok(await page.getByTestId('cmd-group-note').count() === 1, 'search: Notes group');
  ok(await page.getByTestId('cmd-group-task').count() === 1, 'search: Tasks group');
  ok(await page.getByTestId('cmd-group-tag').count() === 1, 'search: Tags group');
  ok(await page.getByTestId('cmd-group-event').count() === (sameDayMeeting ? 1 : 0), 'search: Events group when an event matches');
  ok(await page.locator('.cmd-count').first().innerText() !== '', 'group shows a count');
  ok(await page.locator('mark.cmd-hl').count() >= 2, 'matches are highlighted');
  ok(await page.locator('.cmd-seeall').count() >= 1, 'See all link shown');
  await page.screenshot({ path: `${SH}-search.png` });
  await page.getByTestId('cmd-group-note').locator('.cmd-seeall').click(); await page.waitForTimeout(1200);
  ok(await page.locator('input[aria-label="Search notes"]').inputValue() === 'orbit', 'notes search box is filled with the query');

  // ---------- holidays ----------
  await page.goto(`${b.base}/calendar`); await page.waitForTimeout(1500);
  await page.getByRole('tab', { name: 'Month' }).click();
  // go to a month with a known holiday: Jan 2027 has Republic Day (Jan 26)
  const target = new Date(2027, 0, 1);
  for (let i = 0; i < 24; i++) { const t = await page.locator('.s-h1').innerText(); if (/January/.test(t) && (await page.locator('.s-sub').innerText()).includes('2027')) break; await page.getByRole('button', { name: 'Next' }).click(); await page.waitForTimeout(120); }
  ok(await page.locator('.s-hol-chip', { hasText: 'Republic Day' }).count() === 1, 'month view shows Republic Day (India)');
  await page.screenshot({ path: `${SH}-holidays.png` });
  await page.getByLabel('Holiday country').selectOption('US'); await page.waitForTimeout(400);
  ok(await page.locator('.s-hol-chip', { hasText: 'Martin Luther King' }).count() === 1 && await page.locator('.s-hol-chip', { hasText: 'Republic Day' }).count() === 0, 'switching country swaps the holidays');
  await page.getByLabel('Holiday country').selectOption('IN');
  await page.getByRole('switch', { name: 'Show holidays' }).click(); await page.waitForTimeout(300);
  ok(await page.locator('.s-hol-chip').count() === 0, 'turning holidays off hides them');
  await page.getByRole('switch', { name: 'Show holidays' }).click();
  await page.getByRole('tab', { name: 'Week' }).click(); await page.waitForTimeout(300);

  // ---------- reminders + travel ----------
  const meet = await b.api('POST', '/api/todos', { text: 'Design review', priority: 'medium', tags: [], deadline: iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2)), startTime: '16:30', endTime: '17:30', meta: { reminders: [10, 1440, 10, 99999999], travelMin: 25 } });
  const mm = (await b.api('GET', '/api/todos')).todos.find((t) => t.text === 'Design review');
  ok(JSON.stringify(mm.meta.reminders) === '[10,1440]' && mm.meta.travelMin === 25, 'server keeps reminders (deduped, valid) and travel time');
  await b.api('PATCH', `/api/todos/${mm.id}`, { meta: { reminders: [], travelMin: null } });
  const mm2 = (await b.api('GET', '/api/todos')).todos.find((t) => t.text === 'Design review');
  ok(!mm2.meta?.reminders && !mm2.meta?.travelMin, 'empty reminders and travel clear');
  await page.goto(`${b.base}/tasks`); await page.waitForTimeout(1200);
  await page.getByText('Design review').first().click(); await page.waitForTimeout(800);
  const sheetOpen = await page.getByRole('group', { name: 'Remind me' }).count();
  ok(sheetOpen === 1, 'task sheet has multi-select reminders');
  await page.getByRole('group', { name: 'Remind me' }).getByRole('button', { name: '10 min before' }).click();
  await page.getByRole('group', { name: 'Remind me' }).getByRole('button', { name: '1 day before' }).click();
  ok(await page.getByRole('group', { name: 'Travel time' }).count() === 1, 'timed task shows Travel time');
  await page.getByRole('group', { name: 'Travel time' }).getByRole('button', { name: '25 min' }).click();
  await page.screenshot({ path: `${SH}-reminders.png` });
  await page.locator('.s-capture-add', { hasText: 'Save' }).click(); await page.waitForTimeout(1000);
  const saved = (await b.api('GET', '/api/todos')).todos.find((t) => t.text === 'Design review');
  ok(JSON.stringify(saved.meta?.reminders) === '[10,1440]' && saved.meta?.travelMin === 25 && saved.meta?.remindMin === 10, 'sheet saved two reminders, travel time and the single remindMin');

  // ---------- home widgets ----------
  await page.goto(`${b.base}/`); await page.waitForTimeout(1200);
  await page.getByTestId('home-widgets-tab').click(); await page.waitForTimeout(800);
  ok(await page.getByTestId('home-widgets').count() === 1, 'Widgets view opens');
  await page.getByRole('button', { name: 'Add habit' }).click();
  await page.getByLabel('New habit').fill('Read 20 min'); await page.keyboard.press('Enter'); await page.waitForTimeout(600);
  ok(await page.getByTestId('habit').count() === 1, 'habit added');
  const dots = page.getByTestId('habit').locator('.dots button');
  ok(await dots.count() === 7, 'habit shows 7 days');
  await dots.nth(6).click(); await dots.nth(5).click(); await page.waitForTimeout(500);
  ok((await page.getByTestId('habit').locator('b').innerText()).startsWith('2'), 'streak counts 2 days');
  ok((await page.getByTestId('habit-percent').innerText()) === '29%', 'week percent 2 of 7');
  await page.reload(); await page.waitForTimeout(1500);
  ok(await page.getByTestId('habit').count() === 1 && (await page.getByTestId('habit').locator('b').innerText()).startsWith('2'), 'habit survives a reload (saved to account)');
  await page.screenshot({ path: `${SH}-widgets.png` });
  await page.getByTestId('close-day').click(); await page.waitForTimeout(500);
  ok(await page.getByTestId('close-day').innerText() === 'Day closed', 'Close the day marks the ritual done');
  await page.getByTestId('home-widgets-tab').locator('xpath=..').getByRole('tab', { name: 'Today' }).click(); await page.waitForTimeout(500);
  ok(await page.locator('.s-home-hero').count() === 1, 'Today view is still there');
} catch (e) { b.check('no error: ' + e.message, false); }
await b.finish();
