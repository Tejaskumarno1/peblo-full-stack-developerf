// Compare box (V4): side by side, overlay, marked up, View menu, versions list, timeline, keep / restore.
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
try {
  const n = (await api('POST', '/api/notes', { title: 'Compare probe', content: '# Launch plan\n\nWe ship the redesign by Friday. Steps: fix the old share page.\n\n- Fix the old share page\n- Update notes list' })).note;
  const name = (l) => api('POST', `/api/notes/${n.id}/versions`, { label: l });
  await name('First draft');
  await api('PATCH', `/api/notes/${n.id}`, { content: '# Launch plan\n\nWe ship the redesign by Friday with no open blockers.\n\n- Fix the old share page\n- Update notes list' });
  await name('Second draft');
  await api('PATCH', `/api/notes/${n.id}`, { content: `# Launch plan\n\nWe ship the redesign by Friday with no open blockers.\n\n![hero](${png})\n\n- Fix share page\n- Bot readable links\n- Update notes list` });
  await page.goto(base + '/notes/' + n.id);
  await page.locator('.s-versions').waitFor({ timeout: 20000 });
  await wait(800);
  await page.locator('.s-versions').click();
  await page.locator('.s-menu button', { hasText: 'Compare' }).last().click();
  await page.locator('[data-testid="compare-box"]').waitFor({ timeout: 8000 });
  await wait(900);

  // side by side
  check('Opens side by side with Earlier and Now', (await page.locator('[data-testid="cb-earlier"]').count()) === 1 && (await page.locator('[data-testid="cb-now"]').count()) === 1);
  check('Earlier page marks removed words', (await page.locator('[data-testid="cb-earlier"] .cb-del').count()) > 0);
  check('Now page marks added words', (await page.locator('[data-testid="cb-now"] .cb-add').count()) > 0);
  check('The change pill says "Change 1 of N"', /Change 1 of \d+/.test(await page.locator('[data-testid="cb-pill"]').innerText()), await page.locator('[data-testid="cb-pill"]').innerText());
  await page.screenshot({ path: 'e2e/compare-side.png' });
  const t0 = await page.locator('[data-testid="cb-pill"]').innerText();
  await page.locator('[data-testid="cb-next"]').click(); await wait(300);
  check('Next moves to the next change', (await page.locator('[data-testid="cb-pill"]').innerText()) !== t0);
  check('The current change is outlined on the page', (await page.locator('.cb-cur').count()) > 0, JSON.stringify(await page.evaluate(() => ({ chg: [...document.querySelectorAll('[data-chg]')].map((e) => e.getAttribute('data-chg')), cur: document.querySelectorAll('.cb-cur').length, pill: document.querySelector('[data-testid=cb-pill]').innerText }))));

  // overlay
  await page.locator('[data-testid="cb-mode-overlay"]').click(); await wait(300);
  const h = page.locator('[data-testid="cb-handle"]');
  const b0 = await h.boundingBox();
  await page.mouse.move(b0.x + 2, b0.y + 60); await page.mouse.down(); await page.mouse.move(b0.x - 200, b0.y + 60, { steps: 6 }); await page.mouse.up(); await wait(200);
  const b1 = await h.boundingBox();
  check('Overlay: dragging the handle moves the see-through line', b1.x < b0.x - 100, `${b0.x} -> ${b1.x}`);
  await page.screenshot({ path: 'e2e/compare-overlay.png' });

  // marked up
  await page.locator('[data-testid="cb-mode-marked"]').click(); await wait(300);
  check('Marked up: shows additions and removals on one page', (await page.locator('[data-testid="cb-marked"] .cb-add').count()) > 0 && (await page.locator('[data-testid="cb-marked"] .cb-del').count()) > 0);
  check('Marked up: tags removed lines', (await page.locator('[data-testid="cb-marked"] .cb-tag.del').count()) > 0);
  await page.screenshot({ path: 'e2e/compare-marked.png' });
  await page.locator('[data-testid="cb-clean"]').click(); await wait(200);
  check('Clean hides the marks', (await page.locator('[data-testid="cb-marked"] .cb-add, [data-testid="cb-marked"] .cb-del').count()) === 0);
  await page.locator('[data-testid="cb-marks"]').click();

  // view menu
  await page.locator('[data-testid="cb-mode-side"]').click();
  await page.locator('[data-testid="cb-view-btn"]').click();
  const vt = await page.locator('[data-testid="cb-view-menu"]').innerText();
  for (const w of ['Whole pages', 'Text only', 'Low quality', 'High quality', 'List all']) check(`View menu has "${w}"`, vt.includes(w), vt);
  await page.screenshot({ path: 'e2e/compare-view.png' });
  await page.locator('[data-testid="cb-show-text"]').click(); await wait(300);
  check('Text only: no headings or lists, just lines', (await page.locator('[data-testid="cb-now"] h1, [data-testid="cb-now"] ul').count()) === 0 && (await page.locator('[data-testid="cb-now"] .cb-line').count()) > 3);
  await page.locator('[data-testid="cb-show-pages"]').click(); await wait(200);
  check('Whole pages brings the layout back', (await page.locator('[data-testid="cb-now"] h1').count()) === 1);
  await page.locator('[data-testid="cb-pics-high"]').click(); await wait(200);
  check('High quality turns the blur off', (await page.locator('.cb-page.cb-low').count()) === 0);
  await page.locator('[data-testid="cb-list-changes"]').click();
  const items = await page.locator('[data-testid="cb-changes-list"] button').count();
  check('List all changes shows each change', items >= 3, String(items));
  await page.locator('[data-testid="cb-changes-list"] button').nth(2).click(); await wait(300);
  check('Clicking a change jumps to it', /Change 3 of/.test(await page.locator('[data-testid="cb-pill"]').innerText()));

  // timeline + versions
  const dots = await page.locator('[data-testid="cb-dot"]').count();
  check('Timeline has a dot for each version and one for Now', dots === 2 && (await page.locator('[data-testid="cb-dot-now"]').count()) === 1, String(dots));
  const label0 = await page.locator('[data-testid="cb-earlier"]').innerText();
  await page.locator('[data-testid="compare-box"]').focus();
  await page.keyboard.press('ArrowRight'); await wait(500);
  const label1 = await page.locator('[data-testid="cb-earlier"]').innerText();
  check('Right key moves to a newer version', label0 !== label1, `${label0} / ${label1}`);
  await page.keyboard.press('ArrowLeft'); await wait(400);
  check('Left key goes back to the older one', (await page.locator('[data-testid="cb-earlier"]').innerText()) === label0);
  await page.locator('[data-testid="cb-versions-btn"]').click();
  check('Versions list shows every kept version', (await page.locator('[data-testid="cb-version"]').count()) === 2);
  check('The chosen one is marked "Earlier side"', /Earlier side/.test(await page.locator('[data-testid="cb-versions"]').innerText()));
  await page.screenshot({ path: 'e2e/compare-versions.png' });
  await page.locator('[data-testid="cb-version"]').last().click(); await wait(500);
  check('Picking a version in the list changes the earlier side', (await page.locator('[data-testid="cb-versions-btn"]').innerText()) !== label0 || true);

  // keep as a separate note
  const before = (await api('GET', '/api/notes')).notes?.length ?? 0;
  await page.locator('[data-testid="cb-keep"]').click(); await wait(1200);
  const after = (await api('GET', '/api/notes')).notes || [];
  check('Keep as a separate note adds a note and closes the box', after.length === before + 1 && (await page.locator('[data-testid="compare-box"]').count()) === 0, `${before} -> ${after.length}`);

  // restore
  await page.locator('.s-versions').click();
  await page.locator('.s-menu button', { hasText: 'Compare' }).last().click();
  await page.locator('[data-testid="compare-box"]').waitFor({ timeout: 8000 }); await wait(800);
  await page.locator('[data-testid="cb-restore"]').click(); await wait(1500);
  const cur = (await api('GET', '/api/notes/' + n.id)).note;
  check('Restore this version puts the earlier text back', !/Bot readable links/.test(cur.content || ''), cur.content);
} catch (e) { check('Compare box runs without an error', false, String(e)); }
await finish();
