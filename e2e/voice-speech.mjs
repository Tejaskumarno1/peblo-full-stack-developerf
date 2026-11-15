// Real speech through the real model: a spoken sentence (made by Windows text to speech) is played into the fake microphone.
// Run with E2E_CHROME_ARGS="--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --use-file-for-fake-audio-capture=<wav>%noloop"
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
try {
  const n = (await api('POST', '/api/notes', { title: 'Speech probe', content: 'Start.' })).note;
  await page.goto(base + '/notes/' + n.id);
  await page.locator('.bn-editor').waitFor({ timeout: 20000 });
  await page.locator('.bn-block-content').first().click(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await page.locator('[data-testid="voice-fab"]').click();
  const ok = await page.waitForFunction(() => /meeting|tomorrow|budget/i.test(document.querySelector('.bn-editor')?.innerText || ''), null, { timeout: 120000 }).then(() => true).catch(() => false);
  const text = await page.locator('.bn-editor').innerText();
  console.log('note text:', JSON.stringify(text));
  check('what was spoken is typed into the note by the in-browser model', ok);
  check('the engine was whisper', (await page.locator('[data-testid="dictation"]').getAttribute('data-engine')) === 'whisper');
} catch (e) { console.log('ERROR', e.stack || e); check('no exception', false, e.message); }
await finish();
