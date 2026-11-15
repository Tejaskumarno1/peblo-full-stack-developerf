// A guest still on the join card is not shown to others as "Guest"; they appear once, with the name they typed.
import { boot } from './lib.mjs';
const { base, api, ctx, check, finish } = await boot({ freshGuest: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const note = (await api('POST', '/api/notes', { title: 'Join names', content: 'Hello\n\n## A\n\nBody', tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  const mk = async (init) => { const c = await ctx.browser().newContext({ viewport: { width: 1440, height: 900 } }); await c.addInitScript(init); return c; };
  const a = await mk(() => { try { localStorage.setItem('peblo-guest-tour', '1'); localStorage.setItem('peblo-guest-joined', '1'); localStorage.setItem('peblo-guest-name', 'Ana'); } catch {} });
  const b = await mk(() => { try { localStorage.setItem('peblo-guest-tour', '1'); } catch {} });
  const pa = await a.newPage(); await pa.goto(`${base}/s/note/${tok}`); await pa.locator('article').waitFor({ timeout: 20000 }); await wait(1500);
  const pb = await b.newPage(); await pb.goto(`${base}/s/note/${tok}`); await pb.getByTestId('join-card').waitFor({ timeout: 20000 });
  await wait(8000); // longer than two beats
  const stack = await pa.getByTestId('hd-stack').getAttribute('aria-label');
  check('someone still on the join card is not counted as a viewer', /^1 on this page/.test(stack || ''), stack);
  check('no "Guest joined" pop-up while they choose a name', (await pa.locator('.cp-toast').filter({ hasText: 'Guest' }).count()) === 0);
  await pb.getByTestId('join-card').getByRole('textbox', { name: 'Your name' }).fill('Bela'); await pb.getByTestId('join-submit').click();
  await pa.locator('.cp-toast', { hasText: 'Bela joined' }).waitFor({ timeout: 15000 });
  check('they appear once, with their own name', (await pa.locator('.cp-toast', { hasText: 'Bela joined' }).count()) === 1);
  check('and never as Guest', (await pa.locator('.cp-toast', { hasText: 'Guest' }).count()) === 0);
} catch (e) { check('share-joinname ran without crashing', false, e?.stack || e); }
await finish();
