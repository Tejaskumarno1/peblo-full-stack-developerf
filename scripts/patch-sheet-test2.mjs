import fs from 'node:fs';
const f = 'e2e/tasks-sheet2.mjs';
let s = fs.readFileSync(f, 'utf8');
const a = "  const soon = new Date(Date.now() + 60000);";
if (!s.includes(a)) throw new Error('missing');
s = s.replace(a, () => "  await page.goto('about:blank'); // an open Tasks page would ring it first and mark it as rung\n  const soon = new Date(Date.now() + 60000);");
fs.writeFileSync(f, s);
console.log('ok');
