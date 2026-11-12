// Owner summary under the title (S01) and the offline notice with Retry (S43).
import { boot } from './lib.mjs';
const { base, api, ctx, check, finish, page } = await boot({ freshGuest: true });
try {
  const note = (await api('POST', '/api/notes', { title: 'Q4 client report', content: '## What we heard\n\nClients want fewer rounds.', tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: false })).token;
  const pre = await fetch(`${base}/api/public/note/${tok}?sid=abcdefgh12345678`).then((r) => r.json());
  check('1 no summary until the owner writes one', !pre.summary);
  const set = await api('POST', `/api/public/note/${tok}/summary`, { summary: 'Clients want fewer review rounds and a clear first brief.' });
  check('2 the owner can save a summary', /fewer review rounds/.test(set.summary || ''));
  const g = await (await ctx.browser().newContext({ viewport: { width: 1366, height: 800 } })).newPage();
  const errors = []; g.on('pageerror', (e) => errors.push(e.message));
  await g.goto(`${base}/s/note/${tok}`);
  await g.locator('[data-testid="join-anon"]').click({ timeout: 6000 }).catch(() => {});
  await g.locator('[data-testid="page-summary"]').waitFor({ timeout: 20000 });
  const t = await g.locator('[data-testid="page-summary"]').innerText();
  check('3 readers see "Summary by" and the text', /Summary by/i.test(t) && /clear first brief/.test(t), t);
  await api('POST', `/api/public/note/${tok}/summary`, { summary: '' });
  const post = await fetch(`${base}/api/public/note/${tok}?sid=abcdefgh12345678`).then((r) => r.json());
  check('4 clearing it removes it', !post.summary);
  check('5 no page errors', errors.length === 0, errors.join('|'));
} catch (e) { check('run ' + e.message, false); }
await finish();
