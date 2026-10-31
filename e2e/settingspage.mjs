// The new Settings page (Soft Studio): sections, search, accounts, connections, shared links, per-feature AI routing.
import { boot } from './lib.mjs';

const { base, api, page, check, finish, token } = await boot();
try {
  const note = (await api('POST', '/api/notes', { title: 'Plan to share', content: 'Hello', tags: [] })).note;
  await api('POST', `/api/share/note/${note.id}`, { edit: true });
  await api('PUT', '/api/profile', { settings: { defaultAiModel: 'auto' } });

  await page.goto(base + '/');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor({ timeout: 15000 });
  check('avatar opens the Settings page', page.url().endsWith('/settings/profile'), page.url());

  const navNames = await page.locator('.s-set-link').allInnerTexts();
  check('seven groups of sections in the menu', navNames.length === 11 && (await page.locator('.s-set-group').count()) === 7, navNames.join('|'));

  // search
  await page.getByLabel('Find a setting').fill('dark');
  await page.getByRole('option', { name: /Appearance/ }).first().click();
  check('search jumps to Appearance', page.url().endsWith('/settings/appearance'));
  await page.screenshot({ path: 'C:/Users/tejas/peblo-e2e/settings-appearance.png' });

  // theme + compact save
  await page.getByRole('radio', { name: /Dark/ }).click();
  check('Dark theme applies', await page.evaluate(() => document.body.classList.contains('theme-dark')));
  await page.getByRole('radio', { name: /Light/ }).click();
  await page.getByRole('switch', { name: 'Compact' }).click();
  await page.waitForTimeout(500);
  check('Compact sets the page attribute', (await page.evaluate(() => document.documentElement.getAttribute('data-compact'))) === '1');
  check('Compact is saved to the account', (await api('GET', '/api/profile')).user?.settings?.compact === true);

  // profile name saves on blur
  await page.goto(base + '/settings/profile');
  const name = page.getByLabel('Display name', { exact: true });
  await name.fill('Renamed Person');
  await name.blur();
  await page.getByText('Saved', { exact: false }).first().waitFor({ timeout: 5000 }).catch(() => {});
  check('name is saved', (await api('GET', '/api/profile')).user?.name === 'Renamed Person');

  // accounts: this device remembers the account, a second one is switchable
  await page.goto(base + '/settings/accounts');
  await page.getByText('Using now').waitFor({ timeout: 8000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('peblo-accounts') || '[]'));
  check('current account remembered on this device', saved.length === 1 && !!saved[0].token);
  const r2 = await (await fetch(base + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `second-${Date.now()}@peblo.test`, password: 'correct horse battery', name: 'Second' }) })).json();
  await page.evaluate((a) => { const l = JSON.parse(localStorage.getItem('peblo-accounts')); l.push(a); localStorage.setItem('peblo-accounts', JSON.stringify(l)); }, { id: r2.user.id, email: r2.user.email, name: 'Second', token: r2.token });
  await page.reload();
  // with two accounts saved, a reload lands on the "Who is using Peblo?" chooser
  await page.getByText('Who is using Peblo?').waitFor({ timeout: 8000 });
  await page.getByText('second-', { exact: false }).first().click();
  await page.waitForTimeout(2500);

  await page.getByText('Second', { exact: false }).first().waitFor({ timeout: 10000 }).catch(() => {});
  const me = await page.evaluate(async () => (await (await fetch('/api/profile', { headers: { Authorization: 'Bearer ' + localStorage.getItem('peblo-token') } })).json()).user?.name);
  check('Switch signs in as the other account', me === 'Second', me);

  // switch back so the rest of the checks see the first account
  await page.evaluate((t) => localStorage.setItem('peblo-token', t), token);
  await page.goto(base + '/settings/connect');
  await page.locator('.s-set-addr code').filter({ hasText: '/mcp' }).waitFor({ timeout: 8000 });
  check('MCP address uses the public address', (await page.locator('.s-set-addr code').innerText()) === `${base}/mcp`);
  await page.getByRole('button', { name: 'Test the connection' }).click();
  await page.locator('.s-set-checks li.ok').nth(2).waitFor({ timeout: 15000 });
  check('Test the connection passes all three checks', (await page.locator('.s-set-checks li.bad').count()) === 0);
  const oauthTok = await api('POST', '/api/tokens', { name: 'Connected: Claude', scope: 'full' });
  await page.reload();
  await page.getByText('Claude', { exact: true }).first().waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: 'Remove access' }).click();
  await page.getByRole('button', { name: 'Yes' }).click();
  await page.waitForTimeout(600);
  const left = (await api('GET', '/api/tokens')).tokens.filter((t) => /^Connected:/.test(t.name));
  check('Remove access revokes the connected app', left.length === 0);

  // activity log shows what an app did
  await fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ' + token }, body: '{}' }).catch(() => {});
  const full = await api('POST', '/api/tokens', { name: 'Connected: ActivityApp', scope: 'full' });
  await fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ' + full.token }, body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_tags', arguments: {} } }) });
  await page.goto(base + '/settings/connect');
  await page.getByText('Looked at the calendar', { exact: false }).first().waitFor({ timeout: 1 }).catch(() => {});
  await page.locator('.s-set-log li', { hasText: 'ActivityApp' }).first().waitFor({ timeout: 8000 });
  check('Activity lists the app and what it did', (await page.locator('.s-set-log li', { hasText: 'Listed tags' }).count()) >= 1);

  // shared links list: switch to view, then stop
  await page.goto(base + '/settings/shared');
  await page.getByText('Plan to share').waitFor({ timeout: 8000 });
  await page.getByRole('radio', { name: 'Can view' }).click();
  await page.waitForTimeout(600);
  check('link switched to view only', (await api('GET', `/api/share/note/${note.id}`)).edit === false);
  await page.getByRole('button', { name: 'Stop sharing' }).click();
  await page.getByRole('button', { name: 'Yes' }).click();
  await page.waitForTimeout(600);
  check('Stop sharing turns the link off', (await api('GET', `/api/share/note/${note.id}`)).token === null);

  // per-feature AI routing is stored and honoured by the server
  // "Where each feature runs" only exists in the desktop app (the preload script adds window.pebloDesktop); on the web it is hidden by design.
  // Announce a desktop shell on the AI page only, so the other sections keep running as the web app.
  await page.addInitScript(() => { if (location.pathname === '/settings/ai') window.pebloDesktop = window.pebloDesktop || {}; });
  await page.goto(base + '/settings/ai');
  const row = page.locator('.s-set-feats li', { hasText: 'Improve writing' });
  await row.getByRole('radio', { name: 'This computer' }).click();
  await page.waitForTimeout(600);
  const st = (await api('GET', '/api/profile')).user.settings;
  check('feature pinned to this computer is saved', st.aiFeatures?.improve === 'local', JSON.stringify(st.aiFeatures));
  const res = await fetch(base + '/api/ai/hub/models', { headers: { Authorization: `Bearer ${token}` } });
  check('hub still answers', res.ok);
  await page.screenshot({ path: 'C:/Users/tejas/peblo-e2e/settings-ai.png' });

  // data + shortcuts + about render
  for (const s of ['data', 'shortcuts', 'about', 'notes']) {
    await page.goto(`${base}/settings/${s}`);
    await page.locator('.s-set-card').first().waitFor({ timeout: 8000 });
  }
  check('remaining sections render', true);
  await page.goto(base + '/settings/nonsense');
  await page.waitForURL(/settings\/profile$/, { timeout: 5000 });
  check('unknown section falls back to Profile', true);
} catch (e) {
  check('settings page run finished', false, e.stack || e.message);
}
await finish();
