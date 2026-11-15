import fs from 'node:fs';
const f = 'e2e/tasks-sheet2.mjs';
let s = fs.readFileSync(f, 'utf8');
const a = "  console.error(e);\n  check('no crash', false, String(e));";
if (!s.includes(a)) throw new Error('missing');
s = s.replace(a, () => "  console.error(e);\n  await page.screenshot({ path: `${shots}/sheet2-fail.png` }).catch(() => {});\n  console.log('URL', page.url(), 'LS', await page.evaluate(() => localStorage.getItem('peblo-reminders-rung')).catch(() => '?'));\n  check('no crash', false, String(e));");
fs.writeFileSync(f, s);
console.log('ok');
