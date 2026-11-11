// People track beside the page and follow banner (mockup S25).
import { boot } from './lib.mjs';
const { base, api, ctx, check, finish } = await boot();
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 200)); } return false; };
try {
  const body = '## Intro\n\n' + Array.from({ length: 24 }, (_, i) => `Paragraph ${i + 1} about normal forms and keys in a relational design.`).join('\n\n');
  const note = (await api('POST', '/api/notes', { title: 'Follow room', content: body, tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true, expiresInDays: 1 })).token;
  const mk = async (name) => { const c = await ctx.browser().newContext({ viewport: { width: 1366, height: 800 } }); await c.addInitScript(() => { try { localStorage.setItem('peblo-guest-tour', '1'); } catch { /* ignore */ } }); const p = await c.newPage(); await p.goto(`${base}/s/note/${tok}`); await p.locator('.bn-editor').waitFor({ timeout: 20000 }); await p.getByLabel('Your name').fill(name); await p.getByLabel('Your name').press('Enter'); return p; };
  const a = await mk('Priya'); const b = await mk('Ravi');
  await a.locator('.bn-editor').getByText('Paragraph 20 about').first().click();
  check('1 the track appears beside the page when someone else is reading', await until(async () => (await b.locator('[data-testid="share-track"]').count()) === 1));
  await until(async () => (await b.locator('.cp-follow').count()) > 0, 4000) || await b.getByTestId('rail-people').click();
  console.log('follow buttons', await b.locator('.cp-follow').count(), 'panel', await b.locator('.cp-drawer, .cp').count());
  await b.locator('.cp-follow').first().click({ timeout: 8000 }).catch((e) => console.log(String(e).slice(0, 200)));
  check('2 following shows the banner', await until(async () => (await b.locator('[data-testid="follow-ban"]').count()) === 1, 8000));
  check('3 the banner names who is followed', /Priya/.test(await b.locator('[data-testid="follow-ban"]').innerText().catch(() => '')));
  await b.locator('[data-testid="follow-stop"]').click().catch(() => {});
  check('4 stop removes the banner', await until(async () => (await b.locator('[data-testid="follow-ban"]').count()) === 0, 6000));
} catch (e) { check('run ' + e.message, false); }
await finish();
