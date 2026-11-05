import fs from 'node:fs';
const css = `\r\n.s-share-ai { display: flex; flex-direction: column; gap: 6px; padding: 10px; border: 1.5px dashed #d9c9b3; border-radius: 14px; }\r\n.s-share-ai > b { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #2a1f17; }\r\n.s-share-ai > small { font-size: 11.5px; line-height: 1.4; color: #8a7a6a; }\r\n.s-share-ai .s-share-go { align-self: stretch; justify-content: center; }\r\n.s-share-ai .s-share-row .s-share-go { align-self: auto; min-width: 84px; padding: 9px 12px; }\r\n`;
for (const f of ['client/src/soft/dialogs.css', 'client/src/soft/soft2.css']) {
  let c = fs.readFileSync(f, 'utf8');
  c = c.replace(/\r?\n\.s-share-ai[^\n]*/g, '');
  fs.writeFileSync(f, c.replace(/\s+$/, '') + css);
}
console.log('ok');
