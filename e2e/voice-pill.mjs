// The voice control: a visible mic button in the note editor that opens a draggable pill; speech is typed into the note.
// Run with E2E_CHROME_ARGS="--use-fake-device-for-media-stream --use-fake-ui-for-media-stream".
// The speech model host is blocked and the server's transcribe answer is mocked, so this proves the chain Whisper -> server.
import { boot } from './lib.mjs';
import fs from 'node:fs';
const { base, api, page, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shots = process.env.SHOTS || 'D:\\Peblo\\_shots';
try { fs.mkdirSync(shots, { recursive: true }); } catch {}
await page.route(/huggingface\.co|\.hf\.co/, (r) => r.abort());
let asked = 0;
await page.route('**/api/ai/transcribe', (r) => { asked += 1; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'hello from the microphone' }) }); });
try {
  const n = (await api('POST', '/api/notes', { title: 'Voice probe', content: 'Start.' })).note;
  await page.goto(base + '/notes/' + n.id);
  await page.locator('.bn-editor').waitFor({ timeout: 20000 });
  await wait(1200);
  const fab = page.locator('[data-testid="voice-fab"]');
  check('a mic button is visible in the note editor', await fab.isVisible());
  const vp = page.viewportSize();
  let b = await fab.boundingBox();
  check('the mic button is on screen', b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width && b.y + b.height <= vp.height, JSON.stringify(b));
  await page.screenshot({ path: shots + '\\voice-idle.png' });

  // drag the round button, then it stays there after a reload
  await page.mouse.move(b.x + 22, b.y + 22); await page.mouse.down();
  await page.mouse.move(b.x - 200, b.y - 150, { steps: 8 }); await page.mouse.up();
  const b2 = await fab.boundingBox();
  check('dragging moves the mic button', Math.abs(b2.x - (b.x - 222)) < 24 && Math.abs(b2.y - (b.y - 172)) < 24, JSON.stringify([b, b2]));
  check('the drag did not start dictation', (await page.locator('[data-testid="dictation"]').count()) === 0);
  await page.reload(); await page.locator('.bn-editor').waitFor({ timeout: 20000 }); await wait(800);
  const b3 = await page.locator('[data-testid="voice-fab"]').boundingBox();
  check('its place is remembered after a reload', Math.abs(b3.x - b2.x) < 2 && Math.abs(b3.y - b2.y) < 2, JSON.stringify([b2, b3]));
  // keyboard
  await page.locator('[data-testid="voice-fab"]').focus();
  await page.keyboard.press('ArrowRight');
  const b4 = await page.locator('[data-testid="voice-fab"]').boundingBox();
  check('arrow keys move it', Math.abs(b4.x - (b3.x + 16)) < 2, JSON.stringify([b3, b4]));
  // clamped
  await page.mouse.move(b4.x + 22, b4.y + 22); await page.mouse.down();
  await page.mouse.move(-400, -400, { steps: 6 }); await page.mouse.up();
  const b5 = await page.locator('[data-testid="voice-fab"]').boundingBox();
  check('it cannot be dragged off the screen', b5.x >= 0 && b5.y >= 0, JSON.stringify(b5));
  await page.keyboard.press('Home');
  const b6 = await page.locator('[data-testid="voice-fab"]').boundingBox();
  check('Home puts it back', b6.x > vp.width - 120, JSON.stringify(b6));

  // dictate: click, the pill opens, speech comes from the (mocked) server answer, and is typed in the note
  await page.locator('.bn-block-content').first().click(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await page.locator('[data-testid="voice-fab"]').click();
  await page.locator('[data-testid="dictation"]').waitFor({ timeout: 5000 });
  check('clicking opens the pill', true);
  await page.waitForFunction(() => /hello from the microphone/.test(document.querySelector('.bn-editor')?.innerText || ''), null, { timeout: 30000 }).then(() => check('speech is typed into the note', true)).catch(() => check('speech is typed into the note', false, asked));
  check('the pill reports an engine', !!(await page.locator('[data-testid="dictation"]').getAttribute('data-engine')));
  await page.screenshot({ path: shots + '\\voice-listening.png' });

  // the pill drags too, and sits above Focus mode
  const p0 = await page.locator('[data-testid="dictation"]').boundingBox();
  await page.mouse.move(p0.x + 6, p0.y + p0.height / 2); await page.mouse.down();
  await page.mouse.move(p0.x - 160, p0.y - 120, { steps: 8 }); await page.mouse.up();
  const p1 = await page.locator('[data-testid="dictation"]').boundingBox();
  check('the listening pill can be dragged', Math.abs(p1.x - (p0.x - 166)) < 30 || p1.x < p0.x - 100, JSON.stringify([p0, p1]));
  await page.evaluate(() => document.documentElement.setAttribute('data-fs', '1'));
  const top = await page.evaluate(() => { const r = document.querySelector('[data-testid="dictation"]').getBoundingClientRect(); const e = document.elementFromPoint(r.x + 20, r.y + r.height / 2); return !!e?.closest('[data-testid="dictation"]'); });
  check('in Focus mode the pill stays on top', top);
  await page.evaluate(() => document.documentElement.removeAttribute('data-fs'));
  await page.locator('[data-testid="dictation-pause"]').click();
  check('pause works', (await page.locator('[data-testid="dictation"]').getAttribute('data-state')) === 'paused');
  await page.locator('[data-testid="dictation-pause"]').click();
  await page.locator('[data-testid="dictation-done"]').click();
  await page.locator('[data-testid="dictation"]').waitFor({ state: 'detached', timeout: 5000 });
  check('Done closes the pill and the round button returns', await page.locator('[data-testid="voice-fab"]').isVisible());
  // the insert menu entry still works
  await page.locator('.bn-block-content').last().click(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await page.keyboard.type('/dict'); await page.locator('.bn-suggestion-menu').waitFor({ timeout: 5000 }); await page.keyboard.press('Enter');
  await page.locator('[data-testid="dictation"]').waitFor({ timeout: 5000 });
  check('the /dictate entry opens the same pill', true);
  await page.locator('[data-testid="dictation-done"]').click();
} catch (e) { console.log('ERROR', e.stack || e); check('no exception', false, e.message); }
await finish();
