import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
try {
  await api('POST', '/api/notes', { title: 'Private note', content: 'secret body' });
  await page.goto(base + '/notes');
  await page.locator('.nl-row', { hasText: 'Private note' }).first().waitFor({ timeout: 15000 });
  // pretend a previous session left account data on this computer (both key styles the app uses)
  await page.evaluate(() => {
    localStorage.setItem('peblo_cached_notes', JSON.stringify([{ id: 'x', title: 'Previous account note' }]));
    localStorage.setItem('peblo_called_tasks', '["t1"]');
    localStorage.setItem('peblo_last_morning_briefing', '2026-10-09');
    localStorage.setItem('peblo-ai-hub-v1', '[{"id":"c","messages":[]}]');
    localStorage.setItem('peblo-settings', '{"geminiKey":"leftover"}');
    localStorage.setItem('peblo-notifications', '[{"id":1}]');
    localStorage.setItem('peblo_call_rate', '1.2');
    localStorage.setItem('peblo-theme', 'dark');
  });
  const keys = () => page.evaluate(() => Object.keys(localStorage).sort());

  // a forced sign-out (expired token / other window) fires this event
  await page.evaluate(() => window.dispatchEvent(new Event('peblo:signed-out')));
  await page.waitForTimeout(800);
  const after = await keys();
  const leftovers = after.filter((k) => /^peblo[-_]/.test(k) && !['peblo-theme', 'peblo-style', 'peblo-sidebar-collapsed', 'peblo-river-zoom', 'peblo-river-notes-view', 'peblo_call_gender', 'peblo_call_rate', 'peblo_call_ringtone'].includes(k));
  check('no account data left after sign-out', leftovers.length === 0, leftovers.join(', '));
  check('device preferences are kept (theme, call rate)', after.includes('peblo-theme') && after.includes('peblo_call_rate'), after.join(', '));
  check('the sign-in screen is shown', await page.getByRole('button', { name: /sign in|log in/i }).first().isVisible().catch(() => false));
} catch (e) { console.error(e); process.exitCode = 1; }
await finish();
