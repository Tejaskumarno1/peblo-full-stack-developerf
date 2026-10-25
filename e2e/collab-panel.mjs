// The Live collaboration panel, header chips, statuses, join/leave, removing a guest, reconnecting — owner and guest side.
import { boot } from './lib.mjs';

const { base, api, page, ctx, check, finish } = await boot();
const SHOTS = 'C:/Users/tejas/Documents/peblo-full-stack-developerf/.shots';
try {
  const note = (await api('POST', '/api/notes', { title: 'Collab note', content: '# Orbit\n\nFirst line\n\nSecond line', tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  await page.addInitScript(() => { try { localStorage.setItem('peblo-style', 'soft'); localStorage.setItem('peblo-collab-tip', '1'); } catch { /* ignore */ } });
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto(`${base}/notes/${note.id}`);
  await page.locator('.bn-editor').waitFor({ timeout: 15000 });

  // header chips next to the title
  const chips = page.getByTestId('share-chips');
  await chips.waitFor({ timeout: 8000 });
  const ct = await chips.innerText();
  check('chips say the link is active and who can edit', /Shared link active/.test(ct) && /view & edit/.test(ct) && /Copy link/.test(ct) && /Live/.test(ct), ct);

  // a guest opens the link
  const gctx = await ctx.browser().newContext({ viewport: { width: 1280, height: 800 } });
  const g = await gctx.newPage();
  await g.goto(`${base}/s/note/${tok}`);
  const edG = g.locator('.bn-editor');
  await edG.waitFor({ timeout: 15000 });
  await g.getByLabel('Your name').fill('Aarav');
  await g.getByLabel('Your name').press('Enter');
  await g.waitForTimeout(500);

  // owner panel: viewers with statuses
  await page.getByTestId('live-editors').waitFor({ timeout: 9000 });
  check('bottom bar counts the guest', /Aarav is viewing|viewing/.test(await page.getByTestId('live-editors').innerText()));
  await chips.getByRole('button', { name: /live collaboration/i }).click();
  const panel = page.getByTestId('live-panel');
  await panel.waitFor({ timeout: 5000 });
  await page.waitForFunction(() => /Aarav/.test(document.querySelector('[data-testid="live-viewers"]')?.textContent || ''), null, { timeout: 8000 });
  let vt = await page.getByTestId('live-viewers').innerText();
  check('viewers list shows You (owner) and the guest', /You/.test(vt) && /Aarav/.test(vt), vt);
  check('the guest on an editable link is Viewing', /Aarav[\s\S]*Viewing/.test(vt), vt);
  check('viewer count heading', /Viewers \(2\)/.test(await panel.innerText()), (await panel.innerText()).slice(0, 80));

  // editing status while typing
  await edG.click(); await g.keyboard.press('Control+End');
  const end = Date.now() + 5000; let i = 0;
  const typing = (async () => { while (Date.now() < end) { await g.keyboard.type('abc'[i++ % 3]); await g.waitForTimeout(180); } })();
  await page.waitForFunction(() => /Aarav[\s\S]*Editing/.test(document.querySelector('[data-testid="live-viewers"]')?.textContent || ''), null, { timeout: 8000 });
  check('typing guest shows as Editing', true);
  await page.screenshot({ path: `${SHOTS}/collab-owner-panel.png` });
  await typing;
  await page.waitForTimeout(1500);

  // activity tab and join event
  await panel.getByRole('tab', { name: 'Activity' }).click();
  await page.getByTestId('live-activity').locator('li').first().waitFor({ timeout: 8000 });
  const log = await page.getByTestId('live-activity').innerText();
  check('activity lists the guest opening the note and joining', /opened the note/.test(log) && /joined/.test(log), log);
  await panel.getByRole('tab', { name: 'Viewers' }).click();

  // the guest's own panel
  if (!(await g.getByTestId('live-panel').isVisible())) await g.getByRole('button', { name: /Open live collaboration/ }).click(); // docked and open by default on wide screens
  const gp = g.getByTestId('live-panel');
  await gp.waitFor({ timeout: 5000 });
  await g.waitForFunction(() => /Owner/.test(document.querySelector('[data-testid="live-viewers"]')?.textContent || ''), null, { timeout: 9000 });
  const gt = await g.getByTestId('live-viewers').innerText();
  check('guest panel shows the owner and "You"', /Owner/.test(gt) && /You/.test(gt), gt);
  check('guest panel has no access controls', (await gp.getByText('Turn sharing off').count()) === 0);
  await g.screenshot({ path: `${SHOTS}/collab-guest-panel.png` });

  // owner removes the guest
  await panel.getByRole('button', { name: /Options for Aarav/ }).click();
  await page.getByRole('menuitem', { name: /Remove from this link/ }).click();
  await g.getByText(/owner removed you/i).waitFor({ timeout: 10000 });
  check('removed guest is shown a clear message', true);
  const put = await fetch(`${base}/api/public/note/${tok}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'sneaky', sessionId: await g.evaluate(() => Object.entries(sessionStorage).find(([k]) => k.startsWith('peblo-share-viewer'))?.[1]) }) });
  check('removed guest cannot save any more', put.status === 403, String(put.status));
  await page.waitForFunction(() => !/Aarav/.test(document.querySelector('[data-testid="live-viewers"]')?.textContent || ''), null, { timeout: 8000 });
  check('owner list no longer shows the guest', true);

  // reconnecting indicator
  await ctx.setOffline(true);
  await page.getByText(/Reconnecting/).first().waitFor({ timeout: 15000 });
  check('owner sees a reconnecting indicator when offline', true);
  await ctx.setOffline(false);
  await page.getByText(/Back online/).first().waitFor({ timeout: 15000 });
  check('and a synced message when back', true);

  // turning sharing off from the panel
  await panel.getByRole('button', { name: 'Turn sharing off' }).click();
  await panel.getByRole('button', { name: 'Turn off' }).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="share-chips"]'), null, { timeout: 8000 });
  const after = await fetch(`${base}/api/public/note/${tok}`);
  check('turning sharing off closes the link', after.status === 404, String(after.status));
  await gctx.close();
} catch (e) { check('ran', false, String(e)); } finally { await finish(); }
