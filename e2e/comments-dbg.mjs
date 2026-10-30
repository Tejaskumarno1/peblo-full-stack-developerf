// Comments, suggestions, mentions, notifications, reactions and named versions - owner and a person on an editing link.
import { boot } from './lib.mjs';

const { base, api, page, ctx, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch { /* retry */ } await wait(150); } return false; };
const focusEmu = async (p) => { const c = await p.context().newCDPSession(p); await c.send('Emulation.setFocusEmulationEnabled', { enabled: true }); };
const ready = async (p) => { await p.locator('.bn-editor').waitFor({ timeout: 20000 }); await p.locator('[data-testid="collab-status"]').waitFor({ state: 'detached', timeout: 20000 }); await wait(500); };
const plain = (p) => p.evaluate(() => { const el = document.querySelector('.bn-editor').cloneNode(true); el.querySelectorAll('.bn-collaboration-cursor__label, .bn-collaboration-cursor__base, .pb-reactions').forEach((n) => n.remove()); return el.innerText.replace(/⁠/g, ''); });
const select = async (p, text) => {
  await p.locator('.bn-editor .bn-block-content').first().click();
  const ok = await p.evaluate((t) => {
    const w = document.createTreeWalker(document.querySelector('.bn-editor'), NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const i = n.nodeValue.indexOf(t);
      if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + t.length); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; }
    }
    return false;
  }, text);
  await wait(400);
  return ok;
};
const BASE = 'The quick brown fox jumps over the lazy dog.\n\nSecond paragraph about cats.';

try {
  const note = (await api('POST', '/api/notes', { title: 'Comments', content: BASE, tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  await focusEmu(page);
  await page.goto(base + '/notes/' + note.id);
  await ready(page);
  const gctx = await ctx.browser().newContext({ viewport: { width: 1440, height: 900 } });
  const g = await gctx.newPage();
  await focusEmu(g);
  const errors = [];
  g.on('pageerror', (e) => errors.push(e.message));
  page.on('pageerror', (e) => errors.push(e.message));
  await g.goto(`${base}/s/note/${tok}`);
  await ready(g);

  // 1. the guest comments on some words
  check('1 the words can be selected', await select(g, 'quick brown fox'));
  await g.locator('[data-testid="comments-button"]').click();
  await g.locator('[data-testid="comment-on-selection"]').click();
  check('1 the draft quotes the selected words', /quick brown fox/.test((await g.locator('[data-testid="comment-draft"]').textContent()) || ''));
  await g.locator('[data-testid="comment-text"]').fill('Is it really a fox? @');
  // mention: pick the owner from the list that appears after the @
  const option = g.locator('.pb-cmen button').first();
  const gotOptions = await option.waitFor({ timeout: 6000 }).then(() => true).catch(() => false);
  check('1 typing @ offers the people in the note', gotOptions);
  if (gotOptions) await option.click();
  await g.locator('[data-testid="comment-send"]').click();
  check('1 the comment shows in the guest\'s list', await until(async () => (await g.locator('[data-testid="comment-thread"]').count()) === 1));
  check('1 the commented words are marked', await until(async () => (await g.locator('.pb-commented').count()) > 0));

  // 2. the owner sees it, marked, and is told
  check('2 the owner\'s comments button shows 1 open', await until(async () => /1/.test((await page.locator('[data-testid="comments-button"]').textContent()) || ''), 10000));
  check('2 the owner sees the marked words', await until(async () => (await page.locator('.pb-commented').count()) > 0, 8000));
  check('2 the owner gets a notification', await until(async () => /new/.test((await page.locator('[data-testid="notif-pill"]').textContent().catch(() => '')) || ''), 12000));
  await page.locator('[data-testid="notif-pill"]').click();
  const nText = (await page.locator('[data-testid="notifications"]').textContent()) || '';
  check('2 the notification says who mentioned them', /mentioned you/.test(nText), nText.slice(0, 160));
  await page.locator('[data-testid="notif-read-all"]').click();
  check('2 marking read clears the pill', await until(async () => (await page.locator('[data-testid="notif-pill"]').count()) === 0, 6000));

  // 3. the owner replies and resolves
  await page.locator('[data-testid="comments-button"]').click();
  await page.locator('.pb-cthread .acts button', { hasText: 'Reply' }).click();
  await page.locator('.pb-cthread [data-testid="comment-text"]').fill('Yes, a fox.');
  await page.locator('.pb-cthread [data-testid="comment-send"]').click();
  check('3 the reply reaches the guest', await until(async () => /Yes, a fox/.test((await g.locator('.pb-cpanel').textContent().catch(() => '')) || ''), 10000));
  await page.locator('[data-testid="resolve"]').click();
  check('3 resolving removes the mark', await until(async () => (await page.locator('.pb-commented').count()) === 0, 6000));
  check('3 the guest sees it resolved too', await until(async () => (await g.locator('.pb-commented').count()) === 0, 10000));

  // 4. a suggestion: the guest proposes new words, the owner accepts
  await g.locator('[data-testid="comments-button"]').click().catch(() => {});
  check('4 more words can be selected', await select(g, 'lazy dog'));
  if (!(await g.locator('[data-testid="comments-panel"]').count())) await g.locator('[data-testid="comments-button"]').click();
  await g.locator('[data-testid="suggest-on-selection"]').click();
  await g.locator('[data-testid="suggest-text"]').fill('sleepy cat');
  await g.locator('[data-testid="comment-send"]').click();
  check('4 the owner sees the suggestion', await until(async () => (await page.locator('[data-testid="suggestion"]').count()) > 0, 10000));
  await page.locator('[data-testid="accept-suggestion"]').click();
  check('4 accepting changes the owner\'s text', await until(async () => /over the sleepy cat\./.test(await plain(page)), 6000), await plain(page));
  check('4 and the guest\'s text at once', await until(async () => /over the sleepy cat\./.test(await plain(g)), 8000), await plain(g));
  check('4 and the saved note', await until(async () => /sleepy cat/.test((await api('GET', `/api/notes/${note.id}`)).note.content), 10000));

  // 5. reactions
  if (await page.locator('[data-testid="comments-panel"]').count()) await page.locator('[data-testid="comments-button"]').click(); // panel would cover the button
  const para = page.locator('.bn-editor .bn-block-content', { hasText: 'Second paragraph' }).first();
  await para.hover();
  await page.locator('[data-testid="reaction-add"]').waitFor({ timeout: 4000 });
  await page.locator('[data-testid="reaction-add"]').click();
  await page.locator('[data-testid="react-like"]').click();
  check('5 the reaction shows for the owner', await until(async () => (await page.locator('[data-testid="reaction"]').count()) === 1, 4000));
  check('5 and for the guest', await until(async () => /^1$/.test((await g.locator('[data-testid="reaction"]').first().textContent().catch(() => '')) || ''), 6000));
  console.log('DBG', JSON.stringify(await g.evaluate(() => { const el = document.querySelector('[data-testid="reaction"]'); const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { r: [r.x, r.y, r.width, r.height], top: t && (t.className + '|' + t.tagName + '|' + (t.closest('[class]')||{}).className), vh: innerHeight, sy: scrollY }; })));
  await g.screenshot({ path: 'e2e/comments-dbg.png' });
  await g.locator('[data-testid="reaction"]').first().click({ timeout: 5000 });
  check('5 the guest adds theirs: 2', await until(async () => /^2$/.test((await page.locator('[data-testid="reaction"]').first().textContent().catch(() => '')) || ''), 6000));
  check('5 the reaction does not change the note text', !/like/.test((await api('GET', `/api/notes/${note.id}`)).note.content));

  // 6. named versions
  await api('PATCH', `/api/notes/${note.id}`, { content: BASE + '\n\nThird paragraph.' });
  const named = await api('POST', `/api/notes/${note.id}/versions`, { label: 'Before the cats' });
  const list = (await api('GET', `/api/notes/${note.id}/backups`)).backups;
  check('6 a named version is listed with its name', list.some((b) => b.label === 'Before the cats'), JSON.stringify(list.map((b) => b.label)));
  { const refused = await api('POST', `/api/notes/${note.id}/versions`, { label: '  ' }).catch((e) => e); check('6 an empty name is refused', !!refused?.error && !refused?.ok, JSON.stringify(refused).slice(0, 120)); }

  // 7. who may comment
  const strangers = await api('GET', `/api/public/collab/${'x'.repeat(24)}/comments?sid=${'a'.repeat(20)}`).catch((e) => e);
  check('7 an unknown link gets nothing', !strangers?.comments, JSON.stringify(strangers).slice(0, 120));
  const viewNote = (await api('POST', '/api/notes', { title: 'View only', content: 'read me', tags: [] })).note;
  const viewTok = (await api('POST', `/api/share/note/${viewNote.id}`, { edit: false })).token;
  const denied = await api('POST', `/api/public/collab/${viewTok}/comments?sid=${'b'.repeat(20)}`, { body: 'hi', sid: 'b'.repeat(20) }).catch((e) => e);
  check('7 a view-only link cannot comment', !denied?.id, JSON.stringify(denied).slice(0, 120));
  check('no script errors', errors.length === 0, errors.join(' | ').slice(0, 300));
} catch (e) { check('no crash', false, String(e).slice(0, 500)); }
await finish();
