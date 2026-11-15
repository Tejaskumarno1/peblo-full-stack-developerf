// Screenshot of the real share page with the mockup's sample content, for side-by-side checks against the boards.
import { boot } from './lib.mjs';
const { base, api, ctx, check, finish } = await boot({ freshGuest: true });
const OUT = 'D:/Peblo/_shots';
try {
  const md = 'Three themes came up across the six client interviews: speed of delivery, clarity of briefs, and how corrections are handled.\n\n## 1. What we heard\n\nClients praise the team but ask for fewer rounds. Most delays start with an unclear first brief, not with the writing itself.\n\n### Evidence table\n\n| Theme | Evidence | Action |\n| --- | --- | --- |\n| Speed of delivery | Four of six interviews | Move reviews to Tuesday |\n| Clarity of briefs | Two repeat rewrites | One-page brief template |\n| Corrections | Slow sign-off | Name one approver |\n\n## 2. Next steps\n\nWho signs off the final numbers, and by when? Owners are listed in the table above.';
  const note = (await api('POST', '/api/notes', { title: 'Q4 client report', content: md, tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true, expiresInDays: 5 })).token;
  await api('POST', `/api/public/note/${tok}/summary`, { summary: 'Clients want fewer review rounds and a clear first brief. Three actions are owned and dated in the table below.' });
  for (const [w, h, name] of [[1440, 900, '1440'], [1920, 1080, '1920']]) {
    for (const dark of [false]) {
      const c = await ctx.browser().newContext({ viewport: { width: w, height: h } });
      await c.addInitScript((d) => { try { localStorage.setItem('peblo-share-dark', d ? '1' : '0'); } catch {} }, dark);
      const p = await c.newPage();
      await p.goto(`${base}/s/note/${tok}`);
      await p.locator('[data-testid="join-anon"]').click({ timeout: 5000 }).catch(() => {});
      await p.waitForTimeout(3500);
      await p.keyboard.press('Escape'); await p.evaluate(() => { try { localStorage.setItem('peblo-share-tip', '1'); } catch {} document.querySelectorAll('[class*=tip] button, .coach button').forEach((b) => { if (/Next|Got it|close/i.test(b.textContent + b.ariaLabel)) b.click(); }); }); await p.waitForTimeout(300);
      await p.screenshot({ path: `${OUT}/real-S01-${name}${dark ? '-dark' : ''}.png` });
      await c.close();
    }
  }
} catch (e) { check('run ' + e.message, false); }
await finish();
