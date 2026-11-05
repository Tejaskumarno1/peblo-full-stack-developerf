// Right-click menu actions: Move to folder, Tag, Reader view, Public share page, Temporary pictures link, Open to the side.
import { boot } from './lib.mjs';
const { api, page, base, ctx, check, finish } = await boot();
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
await api('PUT', '/api/profile', { settings: { noteFolders: [{ id: 'a', name: 'Orbit', color: 'lilac' }, { id: 'c', name: 'Peblo', color: 'mint' }] } });
const mk = async (title) => (await api('POST', '/api/notes', { title, content: `Body of ${title}`, tags: ['beta'] })).note;
const n1 = await mk('Move me');
await api('POST', '/api/notes', { title: 'Other', content: 'x', tags: ['alpha'] });
const row = () => page.locator('.s-note-row', { hasText: 'Move me' }).first();
const openMenu = async () => { await page.goto(base + '/notes'); await row().waitFor({ timeout: 12000 }); await row().click({ button: 'right' }); await page.locator('[data-testid="app-menu"]').waitFor({ timeout: 4000 }); await page.waitForTimeout(500); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const state = async () => (await api('GET', `/api/notes/${n1.id}`)).note;

await openMenu();
await page.locator('[data-testid="am-move"]').hover();
await page.locator('[data-testid="am-sub-move"]').waitFor({ timeout: 4000 });
const sb = await page.locator('[data-testid="am-sub-move"]').boundingBox(); const vp = page.viewportSize();
check('the submenu is drawn on screen next to the menu', !!sb && sb.x >= 0 && sb.y >= 0 && sb.x + sb.width <= vp.width && sb.y + sb.height <= vp.height, JSON.stringify(sb));
check('Move to folder lists the folders', (await page.locator('[data-testid="am-mv-a"]').count()) === 1 && (await page.locator('[data-testid="am-mv-c"]').count()) === 1);
await page.locator('[data-testid="am-mv-c"]').hover(); await page.locator('[data-testid="am-mv-c"]').click(); await wait(700);
check('the note moved into Peblo', (await state()).meta?.folder === 'Peblo', JSON.stringify((await state()).meta));

await openMenu();
await page.locator('[data-testid="am-tag"]').hover();
await page.locator('[data-testid="am-sub-tag"]').waitFor({ timeout: 4000 });
await page.locator('[data-testid="am-tg-alpha"]').hover(); await page.locator('[data-testid="am-tg-alpha"]').click(); await wait(700);
check('Tag adds #alpha and keeps the old tag', JSON.stringify((await state()).tags.sort()) === JSON.stringify(['alpha', 'beta']), JSON.stringify((await state()).tags));
await openMenu();
await page.locator('[data-testid="am-tag"]').hover();
await page.locator('[data-testid="am-tg-alpha"]').hover(); await page.locator('[data-testid="am-tg-alpha"]').click(); await wait(700);
check('Tag again removes it', JSON.stringify((await state()).tags) === JSON.stringify(['beta']), JSON.stringify((await state()).tags));

await openMenu();
await page.locator('[data-testid="am-open-as"]').hover();
await page.locator('[data-testid="am-as-reader"]').hover(); await page.locator('[data-testid="am-as-reader"]').click(); await wait(1500);
const rb = await page.evaluate(() => [...document.querySelectorAll('button[aria-pressed]')].map((b) => (b.getAttribute('aria-label') || b.title) + ':' + b.getAttribute('aria-pressed')).join(' | '));
check('Reader view opens the note read-only', /view=reader/.test(page.url()) && /Edit:true/.test(rb), page.url() + ' ' + rb);

await openMenu();
await page.locator('[data-testid="am-pics-link"]').click(); await wait(1200);
const link = await api('GET', `/api/share/note/${n1.id}`);
check('Temporary pictures link made a 1-day link', !!link.token && link.expiresAt && new Date(link.expiresAt).getTime() - Date.now() < 26 * 3600e3, JSON.stringify(link));
let clip = ''; try { clip = await page.evaluate(() => navigator.clipboard.readText()); } catch { /* clipboard not readable here */ }
check('its .md address was copied', !clip || clip.endsWith(`${link.token}.md`), clip);

await openMenu();
await page.locator('[data-testid="am-open-as"]').hover();
const popup = ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null);
await page.locator('[data-testid="am-as-public"]').hover(); await page.locator('[data-testid="am-as-public"]').click();
const pp = await popup;
check('Public share page opens the shared page', !!pp && /\/s\/note\//.test(pp.url()), pp ? pp.url() : 'no tab');
if (pp) await pp.close().catch(() => {});

await openMenu();
check('Open to the side is in the menu', (await page.locator('[data-testid="am-open-side"]').count()) === 1);
await finish();
