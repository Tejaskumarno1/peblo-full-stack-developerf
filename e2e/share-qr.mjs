// Owner share panel: QR code for the link, and the big one for a room.
import { boot } from './lib.mjs';

const { base, api, page, check, finish } = await boot();
const SHOTS = 'C:/Users/tejas/peblo-e2e';
try {
  const note = (await api('POST', '/api/notes', { title: 'QR note', content: '# QR\n\nHello', tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: false })).token;
  await page.addInitScript(() => { try { localStorage.setItem('peblo-style', 'soft'); localStorage.setItem('peblo-collab-tip', '1'); } catch { /* ignore */ } });
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto(`${base}/notes/${note.id}`);
  await page.locator('.bn-editor').waitFor({ timeout: 15000 });
  const chips = page.getByTestId('share-chips');
  await chips.waitFor({ timeout: 8000 });
  await chips.getByRole('button', { name: /live collaboration/i }).click();
  await page.getByTestId('live-panel').waitFor({ timeout: 5000 });
  check('QR section is in the owner panel', await page.getByTestId('share-qr').isVisible());
  check('QR is hidden until asked', (await page.getByTestId('qr-img').count()) === 0);
  await page.getByTestId('qr-toggle').click();
  await page.getByTestId('qr-img').waitFor({ timeout: 5000 });
  const src = await page.getByTestId('qr-img').getAttribute('src');
  check('QR is a real image', /^data:image\/png;base64,/.test(src || '') && (src || '').length > 500);
  await page.screenshot({ path: `${SHOTS}/qr-1-panel.png` });
  await page.getByTestId('qr-big').click();
  const full = page.getByTestId('qr-full');
  await full.waitFor({ timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="qr-full"] img'), null, { timeout: 5000 });
  const w = await full.locator('img').evaluate((i) => i.getBoundingClientRect().width);
  check('big QR is large', w >= 400, String(w));
  check('big view shows the link text', (await page.getByTestId('qr-url').innerText()).match(new RegExp(`/s/note/${tok}|/l/[a-z0-9]{6}`)));
  await page.screenshot({ path: `${SHOTS}/qr-2-big.png` });
  await page.keyboard.press('Escape');
  check('Esc closes only the big view', (await full.count()) === 0 && await page.getByTestId('live-panel').isVisible());
} catch (e) { check('qr test ran without error', false, String(e)); }
await finish();
