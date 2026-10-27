// Presenting, second half: poll, reactions with a counter, and sending the recap to everyone.
import { boot } from './lib.mjs';

const { base, api, ctx, check, finish } = await boot();
const SHOTS = 'C:/Users/tejas/peblo-e2e';
const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 150)); } return false; };
async function guest(name, w = 1280) {
  const c = await ctx.browser().newContext({ viewport: { width: w, height: 800 } });
  await c.addInitScript(() => { try { localStorage.setItem('peblo-guest-tour', '1'); } catch { /* ignore */ } });
  return { c, p: await c.newPage(), name };
}
try {
  const content = '## One\n\n' + Array.from({ length: 12 }, (_, i) => `Paragraph number ${i + 1} about normal forms.`).join('\n\n');
  const note = (await api('POST', '/api/notes', { title: 'Poll note', content, tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true, expiresInDays: 1 })).token;
  const P = await guest('Tejas'); const A = await guest('Aarav', 1100); const B = await guest('Diya', 1100);
  for (const u of [P, A, B]) {
    await u.p.goto(`${base}/s/note/${tok}`);
    await u.p.locator('.bn-editor').waitFor({ timeout: 20000 });
    await u.p.getByLabel('Your name').fill(u.name);
    await u.p.getByLabel('Your name').press('Enter');
  }
  const pres = P.p; const a = A.p; const b = B.p;
  await until(async () => (await pres.getByTestId('present-btn').count()) === 1, 20000);
  await pres.getByTestId('present-btn').click(); await pres.getByTestId('present-options').click();
  await pres.getByTestId('present-go').click();
  await pres.getByTestId('presenting-banner').waitFor({ timeout: 8000 });
  check('audience gets reaction buttons even without hands on', await until(async () => (await a.getByTestId('react-up').count()) === 1));

  // reactions
  await a.getByTestId('react-up').click();
  await a.getByTestId('react-up').click();
  await b.getByTestId('react-heart').click();
  await a.getByTestId('react-idea').click();
  check('the dock counts reactions', await until(async () => /2\s*1\s*1/.test((await pres.getByTestId('react-counts').innerText()).replace(/\s+/g, ' ').replace(/(\d) (\d)/g, '$1 $2')) || /^\s*2\s+1\s+1\s*$/.test((await pres.getByTestId('react-counts').innerText()).replace(/\s+/g, ' '))));
  await pres.screenshot({ path: `${SHOTS}/present2-1-reactions.png` });

  // poll
  await pres.getByTestId('dock-poll').click();
  for (let k = 0; k < 6; k++) { console.log('DBG', k, await pres.getByTestId('dock-poll').getAttribute('aria-pressed'), await pres.locator('[data-testid=poll-q]').count()); await new Promise((r) => setTimeout(r, 250)); }
  await pres.getByTestId('dock-poll').click(); await new Promise((r) => setTimeout(r, 400)); console.log('DBG after second click', await pres.getByTestId('dock-poll').getAttribute('aria-pressed'), await pres.locator('[data-testid=poll-q]').count());
  await pres.getByTestId('poll-q').fill('Which normal form next?');
  await pres.getByTestId('poll-in-0').fill('3NF');
  await pres.getByTestId('poll-in-1').fill('BCNF');
  await pres.getByTestId('poll-more').click();
  await pres.getByTestId('poll-in-2').fill('4NF');
  await pres.getByTestId('poll-start').click();
  check('the audience sees the poll', await until(async () => (await a.getByTestId('poll-card').count()) === 1 && /Which normal form next/.test(await a.getByTestId('poll-card').innerText())));
  check('three options', (await a.getByTestId('poll-card').locator('.pc-opt').count()) === 3);
  await a.screenshot({ path: `${SHOTS}/present2-2-poll-aud.png` });
  await a.getByTestId('poll-opt-1').click();
  await b.getByTestId('poll-opt-1').click();
  await b.getByTestId('poll-opt-0').click(); // changed my mind
  check('the presenter sees the tally', await until(async () => {
    const t = (await pres.getByTestId('poll-result').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim());
    return t.length === 3 && /3NF 1/.test(t[0]) && /BCNF 1/.test(t[1]) && /4NF 0/.test(t[2]);
  }));
  check('a voter sees their own choice marked', await a.getByTestId('poll-opt-1').evaluate((e) => e.classList.contains('on')));
  await pres.screenshot({ path: `${SHOTS}/present2-3-poll-pres.png` });
  await pres.getByTestId('poll-close').click();
  check('closing the poll stops voting', await until(async () => (await a.getByTestId('poll-opt-0').isDisabled())));
  check('the audience is told it closed', /poll closed/i.test(await a.getByTestId('poll-card').innerText()));

  // end, recap, send to everyone
  await pres.getByTestId('present-end').click();
  await pres.getByTestId('recap').waitFor({ timeout: 6000 });
  check('the recap lists the poll and reactions', /Which normal form next/.test(await pres.getByTestId('recap-extras').innerText()) && /Like 2, Got it 1, Love it 1/.test(await pres.getByTestId('recap-reacts').innerText()));
  await pres.screenshot({ path: `${SHOTS}/present2-4-recap.png` });
  await pres.getByTestId('recap-send').click();
  check('the button says it was sent', /Sent to everyone/.test(await pres.getByTestId('recap-send').innerText()));
  check('the audience receives the recap', await until(async () => (await a.getByTestId('recap-received').count()) === 1 && (await b.getByTestId('recap-received').count()) === 1));
  const [dl] = await Promise.all([a.waitForEvent('download', { timeout: 8000 }), a.getByTestId('recapr-download').click()]);
  check('they can download it', dl.suggestedFilename() === 'session-recap.md');
  await a.screenshot({ path: `${SHOTS}/present2-5-recap-aud.png` });
  await a.getByTestId('recapr-dismiss').click();
  check('dismissing hides it', (await a.getByTestId('recap-received').count()) === 0);
  await pres.getByTestId('recap-done').click();
  await a.waitForTimeout(3500);
  check('it does not come back after dismissing', (await a.getByTestId('recap-received').count()) === 0);
} catch (e) { check('present2 test ran without error', false, String(e)); }
await finish();
