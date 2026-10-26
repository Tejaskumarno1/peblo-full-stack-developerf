// Presenting on a share link: options card, dark dock, audience list, private notes and timer, hands, questions, tour, recap.
import { boot } from './lib.mjs';

const { base, api, ctx, check, finish } = await boot();
const SHOTS = 'C:/Users/tejas/peblo-e2e';
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 150)); } return false; };

async function guest(name, w = 1280) {
  const c = await ctx.browser().newContext({ viewport: { width: w, height: 800 } });
  const p = await c.newPage();
  return { c, p, name };
}

try {
  const content = '## One\n\n' + Array.from({ length: 24 }, (_, i) => `Paragraph number ${i + 1} about normal forms.`).join('\n\n') + '\n\n## Two\n\nSecond section text.';
  const note = (await api('POST', '/api/notes', { title: 'Presenting note', content, tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true, expiresInDays: 1 })).token;

  const P = await guest('Tejas'); const A = await guest('Aarav', 1100);
  for (const u of [P, A]) {
    await u.p.goto(`${base}/s/note/${tok}`);
    await u.p.locator('.bn-editor').waitFor({ timeout: 20000 });
    await u.p.getByLabel('Your name').fill(u.name);
    await u.p.getByLabel('Your name').press('Enter');
  }
  const pres = P.p; const aud = A.p;
  check('both see the presence bar', await until(async () => (await pres.getByTestId('present-btn').count()) === 1 && (await aud.getByTestId('present-btn').count()) === 1, 20000));

  // options card, then the dock
  await pres.getByTestId('present-btn').click();
  check('Present opens the options card', await pres.getByTestId('present-start').isVisible());
  await pres.screenshot({ path: `${SHOTS}/present-1-start.png` });
  await pres.getByTestId('present-go').click();
  check('the dark dock appears', await pres.getByTestId('presenting-banner').isVisible());
  check('the page marks that someone is presenting', await pres.evaluate(() => document.documentElement.classList.contains('pb-presenting')));
  check('the page tool bar steps aside while presenting', !(await pres.locator('.pb-shared .dh').isVisible()));

  // the room is offered to follow; "keep me with" holds the view
  check('the audience is offered to follow', await until(async () => (await aud.getByTestId('present-offer').count()) === 1));
  await aud.getByTestId('present-keep').click();
  check('audience now following', await until(async () => (await aud.getByTestId('follow-banner').count()) === 1));
  check('audience gets hand and ask buttons', (await aud.getByTestId('raise-hand').count()) === 1 && (await aud.getByTestId('ask-open').count()) === 1);

  // audience list
  await pres.getByTestId('dock-room').click();
  check('audience list shows who follows', await until(async () => /Following you/.test(await pres.getByTestId('panel-room').innerText())));
  check('dock counts followers', await until(async () => /1 following/.test(await pres.getByTestId('presenting-banner').innerText())));
  await pres.screenshot({ path: `${SHOTS}/present-2-audience.png` });

  // hands and questions
  await aud.getByTestId('raise-hand').click();
  await pres.getByTestId('dock-q').click();
  check('presenter sees the hand', await until(async () => (await pres.getByTestId('hand-row').count()) === 1));
  await pres.getByTestId('call-on').click();
  check('the audience sees they were called on', await until(async () => (await aud.getByTestId('called-on').count()) === 1));
  check('their hand goes down', await until(async () => /Raise hand/.test(await aud.getByTestId('raise-hand').innerText())));
  await aud.getByTestId('ask-open').click({ timeout: 6000 });
  await aud.getByTestId('ask-input').fill('Does BCNF keep every dependency?');
  await aud.getByTestId('ask-send').click();
  check('presenter gets the question', await until(async () => (await pres.getByTestId('question').count()) === 1));
  await pres.getByTestId('q-show').click();
  check('the room sees the question on the page', await until(async () => /BCNF/.test(await aud.getByTestId('shown-question').innerText().catch(() => ''))));
  await pres.screenshot({ path: `${SHOTS}/present-3-questions.png` });
  await aud.screenshot({ path: `${SHOTS}/present-3b-audience.png` });
  await pres.getByTestId('q-answered').click();
  check('answering takes it off the page', await until(async () => (await aud.getByTestId('shown-question').count()) === 0));

  // private notes and timer
  await pres.getByTestId('dock-notes').click();
  await pres.getByTestId('note-input').fill('Pause here and ask for the key');
  await pres.getByTestId('note-add').click();
  check('private note kept', /Pause here/.test(await pres.getByTestId('panel-notes').innerText()));
  check('notes are not on the audience page', !/Pause here/.test(await aud.locator('body').innerText()));
  const t1 = await pres.getByTestId('timer-toggle').innerText();
  await pres.getByTestId('timer-toggle').click();
  check('timer can pause', t1 !== (await pres.getByTestId('timer-toggle').innerText()));
  await pres.screenshot({ path: `${SHOTS}/present-4-notes.png` });

  // end: recap
  await pres.getByTestId('present-end').click();
  check('recap opens', await pres.getByTestId('recap').isVisible());
  const rt = await pres.getByTestId('recap').innerText();
  check('recap lists who was there and the question', /Aarav/.test(rt) && /joined/.test(rt) && /question/i.test(rt), rt.slice(0, 160));
  await pres.screenshot({ path: `${SHOTS}/present-5-recap.png` });
  await pres.getByTestId('recap-done').click();
  check('recap closes', (await pres.getByTestId('recap').count()) === 0);
  check('the page returns to normal after ending', !(await pres.evaluate(() => document.documentElement.classList.contains('pb-presenting'))));

  // guided tour
  await pres.getByTestId('present-btn').click();
  await pres.getByTestId('mode-tour').click();
  await pres.getByTestId('present-go').click();
  await pres.getByTestId('dock-tour').click();
  await pres.locator('.bn-editor .bn-block-content', { hasText: 'Paragraph number 3 ' }).first().click();
  await pres.getByTestId('tour-add').click();
  check('a tour stop is added', await until(async () => (await pres.getByTestId('tour-stop').count()) === 1));
  check('the dock offers the next stop', (await pres.getByTestId('next-stop').count()) === 1);
  await pres.getByTestId('present-end').click();
  await pres.getByTestId('recap-done').click();
} catch (e) { try { await A.p.screenshot({ path: SHOTS + '/present-fail-aud.png' }); console.log(await A.p.evaluate(() => { const b = document.querySelector('[data-testid=ask-open]'); if (!b) return 'none'; const r = b.getBoundingClientRect(); const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return JSON.stringify({ r, top: t && (t.className + '|' + t.tagName + '|' + (t.getAttribute('data-testid') || '')) }); })); } catch {} check('presenting test ran without error', false, String(e)); }
await finish();
