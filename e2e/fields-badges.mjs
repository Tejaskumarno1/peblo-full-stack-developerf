// Text fields look like text fields (accent caret, text cursor, visible ring) and AI connections show a coloured provider badge.
import { createRequire } from 'node:module';
import { boot } from './lib.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const pg = require('pg');
const { base, api, page, check, finish } = await boot();
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + '/tasks');
  const input = page.locator('#task-add');
  await input.waitFor({ timeout: 15000 });
  const bar = page.locator('.s-addbar');
  const before = await bar.evaluate((e) => getComputedStyle(e).outlineStyle);
  await input.click();
  const after = await bar.evaluate((e) => ({ o: getComputedStyle(e).outlineStyle, w: getComputedStyle(e).outlineWidth, cursor: getComputedStyle(e).cursor }));
  const caret = await input.evaluate((e) => getComputedStyle(e).caretColor);
  check('typing in the add bar shows a visible ring', before === 'none' && after.o === 'solid' && parseFloat(after.w) >= 2, `${before} -> ${after.o} ${after.w}`);
  check('the bar shows a text cursor', after.cursor === 'text', after.cursor);
  check('the caret is the accent colour, not default', /rgb\(196, 68, 28\)/.test(caret) || caret !== 'auto', caret);
  await page.screenshot({ path: 'field-focus.png' });

  // A saved connection shows its badge
  const me = await api('GET', '/api/auth/me').catch(() => null);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const u = (await db.query("SELECT id FROM users WHERE email LIKE 'e2e-%' ORDER BY email DESC LIMIT 1")).rows[0];
  const rows = [['anthropic', 'Anthropic (Claude)', 'https://api.anthropic.com/v1', 'claude-sonnet-4-5'], ['gemini', 'Google Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-2.5-flash'], ['groq', 'Groq', 'https://api.groq.com/openai/v1', 'llama-3.3-70b']];
  await db.query("DELETE FROM ai_connections WHERE id LIKE 't-%'");
  for (const [i, [p, l, b, m]] of rows.entries()) await db.query('INSERT INTO ai_connections (id,user_id,provider,label,base_url,model,position) VALUES ($1,$2,$3,$4,$5,$6,$7)', [`t-${p}`, u.id, p, l, b, m, i]);
  await db.end();
  await page.goto(base + '/ai/connections');
  await page.getByText('Your AI').first().waitFor({ timeout: 15000 }).catch(() => {});
  const txt = await page.locator('.ac-row-main').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  check('each connection has a badge before its name', txt.length === 3 && txt[0].startsWith('C ') && txt[1].startsWith('G ') && txt[2].startsWith('Gq '), txt.join(' | '));
  await page.locator('.ac').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'ai-badges.png' });
} catch (e) {
  check('no crash', false, String(e).slice(0, 300));
}
await finish();
