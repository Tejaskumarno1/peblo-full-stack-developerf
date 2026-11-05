import { boot } from './lib.mjs';
const { api, page, base, check, finish } = await boot();
await api('PUT', '/api/profile', { settings: { noteFolders: [{ id: 'a', name: 'Orbit', color: 'lilac' }, { id: 'c', name: 'Peblo', color: 'mint' }] } });
const ids = [];
for (let i = 0; i < 11; i += 1) { const r = await api('POST', '/api/notes', { title: `N${i}`, content: `body ${i}`, tags: i % 2 ? ['alpha'] : ['beta'], meta: { folder: i < 4 ? 'Orbit' : i < 8 ? 'Peblo' : '' } }); ids.push(r.note?.id || r.id); }
await page.goto(base + '/notes');
await page.locator('.s-note-row').first().waitFor({ timeout: 12000 });

// Group by Folder shows the folder cards
await page.getByRole('button', { name: /View/ }).click();
await page.getByRole('radio', { name: 'Folder' }).click();
if (await page.locator('.np-pop').count()) await page.keyboard.press('Escape'); await page.waitForTimeout(300);
check('group by Folder shows folder cards and no note rows', (await page.locator('.np-card:not(.mini)').count()) === 2 && (await page.locator('.s-note-row').count()) === 0);
await page.locator('.np-card', { hasText: 'Orbit' }).click();
check('a folder card opens its notes with a one-line breadcrumb', (await page.locator('.np-crumbs b', { hasText: 'Orbit' }).count()) === 1 && (await page.locator('.s-note-row').count()) === 4);
const bc = await page.locator('.np-crumbs').boundingBox();
check('breadcrumb is a single compact row', bc && bc.height < 34, JSON.stringify(bc));

// Group by Tag shows tag cards that filter
await page.locator('.np-crumb-all').click();
await page.getByRole('button', { name: /View/ }).click();
await page.getByRole('radio', { name: 'Tag' }).click();
if (await page.locator('.np-pop').count()) await page.keyboard.press('Escape'); await page.waitForTimeout(300);
check('group by Tag shows a card per tag', (await page.locator('.np-card.mini').count()) >= 2);
await page.locator('.np-card.mini', { hasText: '#alpha' }).click();
check('a tag card filters to its notes', (await page.locator('.s-note-row').count()) === 5);
await page.locator('.np-card.mini', { hasText: '#alpha' }).click();
check('tapping it again shows everything', (await page.locator('.s-note-row').count()) === 11);

// None changes nothing
await page.getByRole('button', { name: /View/ }).click();
await page.getByRole('radio', { name: 'None' }).click();
if (await page.locator('.np-pop').count()) await page.keyboard.press('Escape'); await page.waitForTimeout(300);
check('None shows a plain list with no cards', (await page.locator('.np-card').count()) === 0 && (await page.locator('.s-note-row').count()) === 11);

// tab limit
for (const id of ids) { await page.goto(base + '/notes/' + id); await page.locator('[data-testid="note-tabs"]').waitFor({ timeout: 12000 }); }
await page.waitForTimeout(500);
const tabs = await page.locator('[data-testid="note-tabs"] [role="tab"]').count();
check('open tabs are capped at 8', tabs > 0 && tabs <= 8, String(tabs));

// right-click submenu stays open while moving into it
await page.goto(base + '/notes');
await page.locator('.s-note-row').first().waitFor({ timeout: 12000 });
await page.locator('.s-note-row').first().click({ button: 'right' });
await page.locator('[data-testid="am-open-as"]').hover();
await page.locator('[data-testid="am-sub-open-as"]').waitFor({ timeout: 4000 });
await page.locator('[data-testid="am-as-private"]').hover();
await page.waitForTimeout(500);
check('submenu stays open when the pointer moves onto its items', (await page.locator('[data-testid="am-sub-open-as"]').count()) === 1);
await page.locator('[data-testid="am-as-private"]').click();
await page.waitForTimeout(300);
check('clicking a submenu item runs it and closes the menu', (await page.locator('[data-testid="app-menu"]').count()) === 0);

// menu fits a short window and scrolls
await page.setViewportSize({ width: 1000, height: 380 });
await page.locator('.s-note-row').first().click({ button: 'right', position: { x: 20, y: 10 } });
const m = await page.locator('[data-testid="app-menu"]').boundingBox();
check('menu stays inside a short window', m && m.y >= 0 && m.y + m.height <= 380 + 1, JSON.stringify(m));
await finish();
