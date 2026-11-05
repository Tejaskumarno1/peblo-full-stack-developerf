import fs from 'node:fs';
const f = 'client/src/components/BlockEditor.jsx';
let s = fs.readFileSync(f, 'utf8');
const crlf = s.includes('\r\n');
s = s.replace(/\r\n/g, '\n');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 60)); s = s.replace(a, () => b); };
rep("  useEffect(() => { keepUndo(editor); }, [editor, rt]);\n", `  useEffect(() => { keepUndo(editor); }, [editor, rt]);
  // "Jump to the line": /notes/<id>?line=14 scrolls to the 14th block and marks it for a moment (a task opened from "where it came from").
  useEffect(() => {
    const line = Number(new URLSearchParams(window.location.search).get('line'));
    if (!line || line < 1) return undefined;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      const block = editor.document[line - 1];
      const el = block ? document.querySelector(\`.bn-block-outer[data-id="\${block.id}"]\`) : null;
      if (el) {
        clearInterval(timer);
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.classList.add('pb-jump');
        setTimeout(() => el.classList.remove('pb-jump'), 2600);
      } else if (tries > 25) clearInterval(timer);
    }, 200);
    return () => clearInterval(timer);
  }, [editor, noteId]);
`);
rep("try { await todosAPI.create({ text, priority: 'medium', noteId }); queryClient", "const line = editor.document.findIndex((b) => b.id === (textOf(cur.content).trim() ? cur.id : prev?.id)) + 1;\n        try { await todosAPI.create({ text, priority: 'medium', noteId, meta: { source: { noteId, quote: text, ...(line ? { line } : {}) } } }); queryClient");
if (crlf) s = s.replace(/\n/g, '\r\n');
fs.writeFileSync(f, s);
console.log('ok');
