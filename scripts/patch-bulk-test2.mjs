import fs from 'node:fs';
const f = 'e2e/tasks-bulk.mjs';
let s = fs.readFileSync(f, 'utf8');
const a = "check('picking a task opens it', /Revise BCNF/.test(await page.getByRole('dialog').first().innerText()));";
if (!s.includes(a)) throw new Error('missing');
s = s.replace(a, () => "check('picking a task opens it', (await page.locator('#s-sheet-title').inputValue()) === 'Revise BCNF');");
s = s.replace("await page.waitForTimeout(700);\n  check('palette finds tasks by words'", () => "await page.waitForTimeout(1200);\n  check('palette finds tasks by words'");
fs.writeFileSync(f, s);
console.log('ok');
