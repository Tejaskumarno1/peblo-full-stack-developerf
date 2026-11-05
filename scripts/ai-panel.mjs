import fs from 'node:fs';
const f = 'client/src/soft/ShareDialog.jsx';
let s = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const a = s.indexOf("  const copyBot = async");
const b = s.indexOf("  return (\n    <div className=\"s-share-back\"");
if (a < 0 || b < 0) throw new Error('anchors');
s = s.slice(0, a) + `  const copyText = async (key, text) => {
    try { await navigator.clipboard.writeText(text); } catch { setError('Could not copy. Select the text and copy it by hand.'); return; }
    setError(''); setBotCopied(key); timers.current.push(setTimeout(() => setBotCopied(''), 1800));
  };
  const prompt = \`Read this shared Peblo note and help me with it.\\nPlain text: \${url}.md\\nPDF with pictures: \${url}.pdf\\nIf you have the Peblo MCP connected (\${base}/mcp), call read_shared_link with \${url}.\`;

` + s.slice(b);
s = s.replace("useState(false);\n  const [error", "useState('');\n  const [error");
const r0 = s.indexOf("            {kind === 'note' && <div className=\"s-share-row bot\">");
const r1 = s.indexOf("            {local &&");
if (r0 < 0 || r1 < 0) throw new Error('row anchors');
s = s.slice(0, r0) + `            {kind === 'note' && (
              <div className="s-share-ai" aria-label="Share with AI">
                <b><Bot size={14} /> Share with AI</b>
                {[['md', 'Text (markdown)', url + '.md'], ['pdf', 'PDF with pictures', url + '.pdf'], ['mcp', 'MCP address', base + '/mcp']].map(([k, label, v]) => (
                  <div className="s-share-row bot" key={k}>
                    <input readOnly aria-label={label} title={label} value={v} onFocus={(e) => e.target.select()} />
                    <button type="button" className="s-share-go ghost" onClick={() => copyText(k, v)}>{botCopied === k ? <><Check size={15} /> Copied</> : <><Copy size={15} /> {label.split(' ')[0]}</>}</button>
                  </div>
                ))}
                <button type="button" className="s-share-go" onClick={() => copyText('prompt', prompt)}>{botCopied === 'prompt' ? <><Check size={15} /> Copied</> : <><Bot size={15} /> Copy as AI prompt</>}</button>
                <small>Bots that open the normal link get the plain-text version automatically, with a text description of each picture.</small>
              </div>
            )}
` + s.slice(r1);
fs.writeFileSync(f, s.replace(/\n/g, '\r\n'));
let c = fs.readFileSync('client/src/soft/dialogs.css', 'utf8');
c += `\r\n.s-share-ai { display: flex; flex-direction: column; gap: 6px; padding: 10px; border: 1.5px dashed #eadfce; border-radius: 14px; }\r\n.s-share-ai > b { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #2a1f17; }\r\n.s-share-ai > small { font-size: 11.5px; color: #8a7a6a; }\r\n`;
fs.writeFileSync('client/src/soft/dialogs.css', c);
console.log('ok');
