import fs from 'node:fs';
const f = 'e2e/tasks-focus.mjs';
let s = fs.readFileSync(f, 'utf8');
const a = "content: 'Week plan: [[Databases revision]]'";
if (!s.includes(a)) throw new Error('missing');
s = s.replace(a, () => "content: `Week plan: [Databases revision](/notes/${work.id})`");
fs.writeFileSync(f, s);
console.log('ok');
