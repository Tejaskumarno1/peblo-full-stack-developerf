// Share page right-hand cards (mockup S02): ask card, comments card, header presence/moon/avatar.
import { boot } from './lib.mjs';

const { base, api, ctx, check, finish } = await boot({ freshGuest: true });
const body = ['# Plan', 'We decided to move reviews to Tuesday and the owner signs off. ' + 'words '.repeat(20), '## Next steps', 'Action: send the brief by Friday. ' + 'more '.repeat(20)].join('\n\n');
try {
  const note = (await api('POST', '/api/notes', { title: 'Cards page', content: body, tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  const gc = await ctx.browser().newContext({ viewport: { width: 1700, height: 900 } });
  const g = await gc.newPage();
  const errors = [];
  g.on('pageerror', (e) => errors.push(e.message));
  await g.goto(`${base}/s/note/${tok}`);
  await g.locator('[data-testid="join-anon"]').click({ timeout: 20000 }).catch(() => {});
  await g.locator('[data-testid="rcards"]').waitFor({ timeout: 20000 });
  check('1 cards column shows on a wide screen', await g.locator('[data-testid="rc-ask"]').isVisible());
  await g.locator('.rc-chips button', { hasText: 'Key decisions' }).click();
  check('2 key decisions answers from the page', /Tuesday/.test(await g.locator('[data-testid="rc-reply"]').innerText()));
  await g.locator('.rc-q input').fill('friday brief');
  await g.keyboard.press('Enter');
  check('3 free question finds the line', /Friday/.test(await g.locator('[data-testid="rc-reply"]').innerText()));
  check('4 comments card shows for editors', await g.locator('[data-testid="rc-comments"]').isVisible());
  check('5 moon toggle flips the theme', await (async () => { await g.locator('[data-testid="moon-btn"]').click(); return (await g.locator('.pb-shared').getAttribute('data-theme')) === 'dark'; })());
  check('6 header avatar present', await g.locator('[data-testid="hd-me"]').isVisible());
  check('9 left card shows time left and footer', (await g.locator('[data-testid="toc-time"]').innerText()).includes('min left') && (await g.locator('[data-testid="toc-foot"] button').count()) === 4);
  check('10 title row has its tools', (await g.locator('[data-testid="title-tools"] button').count()) >= 4);
  await g.locator('[data-testid="toc-foot"] button', { hasText: 'Keys' }).click();
  check('11 footer Keys opens shortcuts', await g.locator('[data-testid="keys-sheet"]').isVisible());
  await g.screenshot({ path: 'share-cards.png' });
  await g.keyboard.press('Escape');
  await g.locator('[data-testid="share-btn"]').click();
  check('15 share panel shows link, role, expiry and invite', await g.locator('[data-testid="share-panel"]').isVisible() && /Can edit/.test(await g.locator('[data-testid="share-panel"]').innerText()) && await g.locator('[data-testid="sp-email"]').isVisible());
  check('16 share panel has a QR toggle', (await g.locator('[data-testid="share-panel"]').innerText()).toLowerCase().includes('qr'));
  await g.keyboard.press('Escape'); await g.mouse.click(5, 450);
  await g.locator('[data-testid="hd-me"]').click();
  check('12 identity menu opens with name, sign in, forget, leave', await g.locator('[data-testid="id-menu"]').isVisible() && await g.locator('[data-testid="id-signin"]').isVisible() && await g.locator('[data-testid="id-forget"]').isVisible() && await g.locator('[data-testid="id-leave"]').isVisible());
  await g.locator('[data-testid="id-name"]').fill('Tejas');
  await g.locator('[data-testid="id-name"]').blur();
  check('13 renaming shows the new initial on the avatar', (await g.locator('button[data-testid="hd-me"]').innerText()).trim() === 'T');
  await g.locator('[data-testid="id-forget"]').click();
  check('14 forget clears the saved name', await g.evaluate(() => !localStorage.getItem('peblo-guest-name')));
  const small = await gc.newPage();
  await small.setViewportSize({ width: 1280, height: 800 });
  await small.goto(`${base}/s/note/${tok}`);
  await small.locator('.pb-shared').waitFor({ timeout: 20000 });
  check('7 cards hidden when narrow', !(await small.locator('[data-testid="rcards"]').isVisible()));
  check('8 no page errors', errors.length === 0);
} catch (e) { check('run ' + e.message, false); }
await finish();
