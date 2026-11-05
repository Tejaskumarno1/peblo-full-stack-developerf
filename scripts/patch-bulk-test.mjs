import fs from 'node:fs';
const f = 'e2e/tasks-bulk.mjs';
let s = fs.readFileSync(f, 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing ' + a.slice(0, 50)); s = s.replace(a, () => b); };
rep("await card('Call the vet').click({ modifiers: ['Shift'] });", "await card('Revise BCNF').click({ modifiers: ['Shift'] });");
rep("check('palette finds tasks by words', (await page.locator('.cmd-item', { hasText: 'Revise BCNF' }).count()) >= 1);", "check('palette finds tasks by words', (await page.locator('.cmd-item', { hasText: 'Revise BCNF' }).count()) >= 1, (await page.locator('.cmd-item').allInnerTexts()).join(' | '));");
fs.writeFileSync(f, s);
console.log('ok');
