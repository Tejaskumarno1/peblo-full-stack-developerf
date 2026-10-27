// Share page left icon rail (S2): outline, people, comments, history, file, with flyouts.
import { boot } from './lib.mjs';
const { base, api, ctx, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const body = '# Launch plan\n\n## Scope\n\nWe ship the redesign by Friday.\n\n## Owners\n\nFix the share page.\n\n## Timeline\n\nMonday to Friday.';
try {
  for (const edit of [false, true]) {
    const label = edit ? 'Editor' : 'Reader';
    const note = (await api('POST', '/api/notes', { title: 'Rail ' + label, content: body })).note;
    const tok = (await api('POST', `/api/share/note/${note.id}`, { edit })).token;
    const g = await (await ctx.browser().newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await g.goto(`${base}/s/note/${tok}`);
    await g.locator(edit ? '.bn-editor' : '.doc').waitFor({ timeout: 20000 });
    await wait(1500);
    check(`${label}: the rail has five icons`, (await g.locator('[data-testid="srail"] button').count()) === 5);
    check(`${label}: the outline starts pinned in the page`, (await g.locator('.pb-shared .toc').count()) === 1);
    await g.locator('[data-testid="rail-outline"]').click(); await wait(300);
    check(`${label}: clicking Outline while pinned hides it`, (await g.locator('.pb-shared .toc').count()) === 0);
    await g.locator('[data-testid="rail-outline"]').click(); await wait(300);
    const fly = g.locator('[data-testid="fly-outline"]');
    check(`${label}: Outline opens a flyout with the headings`, /Scope/.test(await fly.innerText()) && /Owners/.test(await fly.innerText()) && /Timeline/.test(await fly.innerText()));
    check(`${label}: the flyout shows reading progress`, /Reading progress \d+ percent/.test(await fly.innerText()));
    if (!edit) await g.screenshot({ path: 'e2e/share-rail.png' });
    await fly.locator('a', { hasText: 'Owners' }).click(); await wait(600);
    check(`${label}: choosing a heading closes the flyout`, (await g.locator('[data-testid="fly-outline"]').count()) === 0);
    await g.locator('[data-testid="rail-outline"]').click(); await wait(200);
    await g.locator('[data-testid="fly-outline"] [data-testid="toc-toggle"]').click(); await wait(300);
    check(`${label}: Pin puts the outline back in the page`, (await g.locator('.pb-shared .toc').count()) === 1);
    await g.locator('[data-testid="rail-people"]').click(); await wait(400);
    check(`${label}: People opens the people flyout`, (await g.locator('[data-testid="fly-people"]').count()) === 1 && /Viewers|Activity/.test(await g.locator('[data-testid="fly-people"]').innerText()));
    await g.locator('[data-testid="rail-history"]').click(); await wait(300);
    check(`${label}: History replaces it`, (await g.locator('[data-testid="fly-history"]').count()) === 1 && (await g.locator('[data-testid="fly-people"]').count()) === 0);
    check(`${label}: History offers bookmarks`, (await g.locator('[data-testid="fly-bookmarks"]').count()) === 1);
    await g.locator('[data-testid="rail-file"]').click(); await wait(300);
    const ft = await g.locator('[data-testid="fly-file"]').innerText();
    check(`${label}: File lists the downloads`, ['Markdown', 'PDF', 'Word', 'Plain text', 'Copy link'].every((w) => ft.includes(w)), ft);
    await g.keyboard.press('Escape'); await wait(200);
    check(`${label}: Esc closes the flyout`, (await g.locator('.srail-fly').count()) === 0);
    const cb = g.locator('[data-testid="rail-comments"]');
    check(`${label}: Comments is ${edit ? 'available' : 'off for readers'}`, edit ? await cb.isEnabled() : await cb.isDisabled());
    if (edit) {
      await cb.click(); await wait(500);
      check('Editor: Comments opens the comments panel', (await g.locator('[data-testid="comments-panel"]').count()) === 1);
    }
    await g.close();
  }
} catch (e) { check('Share rail runs without an error', false, String(e)); }
await finish();
