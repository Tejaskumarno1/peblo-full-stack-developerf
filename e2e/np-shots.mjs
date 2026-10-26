import { boot } from './lib.mjs';
const { base, api, page, finish } = await boot();
const out = 'C:/Users/tejas/peblo-e2e/';
try {
  const mk = (title, tags, extra = {}) => api('POST', '/api/notes', { title, content: `${title} Orbit public pages blocks tools integration words words words`, tags, ...extra });
  await mk('modules yet to finish', ['orbit']); await mk('mistakes', ['peblo']); await mk('eshwar prompt', ['inbox']); await mk('Orbit release checklist', ['orbit']);
  await api('PUT', '/api/profile', { settings: { noteFolders: [{ id: 'a', name: 'Orbit', color: 'lilac' }, { id: 'b', name: 'Peblo', color: 'peach' }, { id: 'c', name: 'This week', color: 'lilac', smart: [{ f: 'edited', v: '7' }] }] } });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + '/notes'); await page.locator('.s-note-row').first().waitFor();
  const list = page.locator('.s-notes-list.np');
  await list.screenshot({ path: out + 'np-home.png' });
  await list.getByRole('button', { name: 'View' }).click(); await list.screenshot({ path: out + 'np-view.png' }); await page.keyboard.press('Escape');
  await list.getByRole('button', { name: 'Select notes' }).click(); await list.locator('.s-note-row').nth(1).click(); await list.locator('.s-note-row').nth(2).click();
  await list.getByRole('button', { name: 'Move' }).click(); await list.screenshot({ path: out + 'np-select.png' });
} catch (e) { console.log(e.message); }
await finish();
