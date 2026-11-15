// The real Whisper model: loads from the model host once, reports progress, runs in the worker, and works offline from the cache afterwards.
// Needs internet the first time. Run with E2E_CHROME_ARGS="--use-fake-device-for-media-stream --use-fake-ui-for-media-stream".
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let asked = 0;
await page.route('**/api/ai/transcribe', (r) => { asked += 1; r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"not used"}' }); });
const seen = new Set();
try {
  const n = (await api('POST', '/api/notes', { title: 'Whisper probe', content: 'Start.' })).note;
  await page.goto(base + '/notes/' + n.id);
  await page.locator('.bn-editor').waitFor({ timeout: 20000 });
  await wait(1000);
  await page.locator('[data-testid="voice-fab"]').click();
  const pill = page.locator('[data-testid="dictation"]');
  await pill.waitFor({ timeout: 5000 });
  const t0 = Date.now();
  let engine = '';
  while (Date.now() - t0 < 240000) {
    seen.add(((await page.locator('[data-testid="dictation-status"]').innerText().catch(() => '')) || '').replace(/\d+%/, 'N%'));
    engine = await pill.getAttribute('data-engine');
    if (engine === 'whisper') break;
    if (await pill.getAttribute('data-state') === 'error') break;
    await wait(500);
  }
  console.log('statuses seen:', [...seen].join(' | '), `(${Math.round((Date.now() - t0) / 1000)}s to ready)`);
  check('the in-browser model loads and the pill reports whisper', engine === 'whisper', engine);
  check('first-use download shows progress', [...seen].some((s) => /Getting ready/.test(s)));
  check('no error on the pill', (await pill.getAttribute('data-state')) !== 'error');
  await wait(6000); // the fake microphone beeps; whatever Whisper hears, nothing must break
  check('the pill is still listening after real audio went through the model', (await pill.getAttribute('data-state')) === 'listening');
  check('the server was not needed', asked === 0, asked);
  await page.locator('[data-testid="dictation-done"]').click();
  // second start: from cache, fast
  await page.reload(); await page.locator('.bn-editor').waitFor({ timeout: 20000 }); await wait(800);
  await page.route(/huggingface\.co|\.hf\.co/, (r) => r.abort()); // the model host is now unreachable
  await page.locator('[data-testid="voice-fab"]').click();
  const t1 = Date.now(); let e2 = '';
  while (Date.now() - t1 < 60000) { e2 = await page.locator('[data-testid="dictation"]').getAttribute('data-engine'); if (e2 === 'whisper') break; await wait(300); }
  check('after the first download it starts offline from the browser cache', e2 === 'whisper', e2);
  console.log(`offline start: ${Math.round((Date.now() - t1) / 1000)}s`);
} catch (e) { console.log('ERROR', e.stack || e); check('no exception', false, e.message); }
await finish();
