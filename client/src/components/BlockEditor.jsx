import { useEffect, useRef, useState } from 'react';
import { BlockNoteView } from '@blocknote/mantine';
import {
  useCreateBlockNote, SuggestionMenuController, getDefaultReactSlashMenuItems,
  FormattingToolbarController, FormattingToolbar, getFormattingToolbarItems, useBlockNoteEditor, useComponentsContext,
} from '@blocknote/react';
import { filterSuggestionItems, SuggestionMenu } from '@blocknote/core/extensions';
import '@blocknote/mantine/style.css';
import { Sparkles, CheckSquare, Wand2, X, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { aiAPI, notesAPI, todosAPI } from '../api/index';
import { fileToAttachment } from '../utils/imageData';
import Backlinks from './Backlinks';
import { useAuth } from '../context/AuthContext';
import './blockEditor.css';

// A picture, video, audio clip or file picked from the computer becomes a data address inside the note
// (pictures are shrunk first). Bigger than 4 MB is refused with a message instead of silently bloating the note.
async function uploadFile(file) {
  const a = await fileToAttachment(file);
  return a.url;
}

/* ---------------------------------------------------------------------------
   Notes are stored as Markdown. Markdown has no video, audio, file or toggle, so those blocks are written
   as a plain link / a "▸ " bullet and turned back into real blocks when the note is opened.
   ------------------------------------------------------------------------------ */
const textOf = (content) => (Array.isArray(content) ? content.map((c) => (c.type === 'link' ? textOf(c.content) : c.text || '')).join('') : typeof content === 'string' ? content : '');

// A picture's size and side are kept in the address ("...#pw=320&ta=right") because Markdown has nowhere else for them.
// A picture made smaller than the column floats to its side, so the text beside it uses the space.
const withLayout = (p) => {
  const q = [];
  if (p.previewWidth) q.push(`pw=${Math.round(p.previewWidth)}`);
  if (p.textAlignment && p.textAlignment !== 'left') q.push(`ta=${p.textAlignment}`);
  const base = String(p.url).split('#')[0];
  return q.length ? `${base}#${q.join('&')}` : base;
};

function toStorage(blocks) {
  return blocks.map((b) => {
    const children = b.children?.length ? toStorage(b.children) : [];
    if (b.type === 'video' || b.type === 'audio' || b.type === 'file') {
      const url = b.props?.url;
      if (!url) return { ...b, type: 'paragraph', props: {}, content: [], children };
      return { id: b.id, type: 'image', props: { url, caption: b.props.name || b.props.caption || b.type }, children };
    }
    if (b.type === 'image' && b.props?.url) return { ...b, props: { ...b.props, url: withLayout(b.props) }, children };
    if (b.type === 'toggleListItem') {
      return { id: b.id, type: 'bulletListItem', props: {}, content: [{ type: 'text', text: '▸ ', styles: {} }, ...(Array.isArray(b.content) ? b.content : [])], children };
    }
    return { ...b, children };
  });
}

function fromStorage(blocks) {
  return blocks.map((b) => {
    const children = b.children?.length ? fromStorage(b.children) : [];
    if (b.type === 'image' && /^data:(?!image\/)/.test(b.props?.url || '')) {
      const url = b.props.url;
      const name = b.props.caption || b.props.name || 'file';
      const m = /^data:(video|audio)\//.exec(url);
      if (m) return { type: m[1], props: { url, name, showPreview: true }, children };
      return { type: 'file', props: { url, name }, children };
    }
    if (b.type === 'image' && typeof b.props?.url === 'string' && /#(?:pw|ta)=/.test(b.props.url)) {
      const [u, ...h] = b.props.url.split('#');
      const q = new URLSearchParams(h.join('#'));
      const pw = Number(q.get('pw'));
      const ta = q.get('ta');
      return { ...b, props: { ...b.props, url: u, ...(pw > 0 ? { previewWidth: pw } : {}), ...(['left', 'center', 'right'].includes(ta) ? { textAlignment: ta } : {}) }, children };
    }
    if (b.type === 'bulletListItem' && Array.isArray(b.content) && b.content[0]?.type === 'text' && /^▸\s/.test(b.content[0].text || '')) {
      const first = { ...b.content[0], text: b.content[0].text.replace(/^▸\s+/, '') };
      return { type: 'toggleListItem', props: {}, content: [first, ...b.content.slice(1)], children };
    }
    return { ...b, children };
  });
}

// Buttons that appear above a picture when it is clicked: where it sits and how wide it is.
function ImageTools() {
  const editor = useBlockNoteEditor();
  const Components = useComponentsContext();
  const sel = editor.getSelection();
  const blocks = sel ? sel.blocks : [editor.getTextCursorPosition().block];
  const b = blocks.length === 1 ? blocks[0] : null;
  if (!b || b.type !== 'image' || !Components) return null;
  const width = () => editor.domElement?.clientWidth || 700;
  const set = (props) => editor.updateBlock(b, { props });
  const Btn = Components.FormattingToolbar.Button;
  const pw = b.props.previewWidth;
  const pct = (p) => Math.round(width() * p);
  const near = (p) => pw && Math.abs(pw - pct(p)) < 12;
  const tag = (t) => <span style={{ fontWeight: 800, fontSize: 12 }}>{t}</span>;
  return (
    <>
      <Btn key="s" mainTooltip="Small picture. Smaller than the page, it sits to one side (use the align buttons) and text wraps beside it" icon={tag('S')} isSelected={near(0.25)} onClick={() => set({ previewWidth: pct(0.25) })} />
      <Btn key="m" mainTooltip="Medium picture" icon={tag('M')} isSelected={near(0.45)} onClick={() => set({ previewWidth: pct(0.45) })} />
      <Btn key="l" mainTooltip="Large picture" icon={tag('L')} isSelected={near(0.7)} onClick={() => set({ previewWidth: pct(0.7) })} />
      <Btn key="f" mainTooltip="Full width, on its own line" icon={tag('Full')} isSelected={!pw} onClick={() => set({ previewWidth: undefined, textAlignment: 'center' })} />
    </>
  );
}
const Toolbar = () => <FormattingToolbar>{[...getFormattingToolbarItems(), <ImageTools key="imagetools" />]}</FormattingToolbar>;

const clean = (l) => l.replace(/^\s*(?:[-*•]\s*(?:\[[ xX]?\]\s*)?|\d+[.)]\s+)/, '').trim();

export default function BlockEditor({ initialContent, onChange, editable = true, formattingToolbar = true, noteId, guest = false }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const linkCache = useRef({ at: 0, notes: [] });
  const editor = useCreateBlockNote({ uploadFile });
  const { theme } = useAuth();
  const loadingRef = useRef(false);
  const [card, setCard] = useState(null); // the AI result card
  const aiBusyRef = useRef(false);

  useEffect(() => {
    try { if (localStorage.getItem('peblo-debug') === '1') window.__pebloEditor = editor; } catch { /* ignore */ }
  }, [editor]);

  useEffect(() => {
    async function loadContent() {
      if (!initialContent) return;
      try {
        const parsed = await editor.tryParseMarkdownToBlocks(initialContent);
        loadingRef.current = true;
        editor.replaceBlocks(editor.document, fromStorage(parsed));
        setTimeout(() => { loadingRef.current = false; }, 0);
      } catch (err) {
        console.error('Failed to parse markdown:', err);
      }
    }
    loadContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]); // Intentionally ignore initialContent to prevent cursor reset on every keystroke

  // Typing [[ opens the note picker (the two brackets are swapped for the picker's @).
  const checkDoubleBracket = () => {
    if (guest || !editable || loadingRef.current) return;
    try {
      const st = editor.prosemirrorState;
      const { from, empty } = st.selection;
      if (!empty || from < 2) return;
      if (st.doc.textBetween(from - 2, from, '\n', '\n') !== '[[') return;
      editor.transact((tr) => tr.delete(from - 2, from));
      editor.getExtension(SuggestionMenu)?.openSuggestionMenu('@');
    } catch { /* if the editor cannot do this, @ still works */ }
  };

  const handleChange = async () => {
    checkDoubleBracket();
    if (!onChange || loadingRef.current || aiBusyRef.current) return;
    const markdown = await editor.blocksToMarkdownLossy(toStorage(editor.document));
    onChange(markdown);
  };

  // ---------- AI: the result lands in a card; nothing in the note changes until you pick what to do ----------
  const sourceFor = (kind) => {
    const pos = editor.getTextCursorPosition();
    const block = pos?.block;
    const sel = (editor.getSelectedText?.() || '').trim();
    let text = sel || textOf(block?.content).trim();
    let scope = sel ? 'selection' : 'block';
    if (kind === 'todo' && text.length < 25) {
      text = editor.document.map((b) => textOf(b.content)).filter(Boolean).join('\n').trim();
      scope = 'note';
    }
    return { blockId: block?.id, text, scope };
  };
  const COMMANDS = { shorter: 'Rewrite much shorter, keeping the meaning:', simpler: 'Rewrite in simpler, plainer words:' };
  const runAi = async (kind, source, command) => {
    const src = source || sourceFor(kind);
    if (!src.text) { setCard({ kind, src, status: 'error', error: 'Type or select some text first, then run this again.' }); return; }
    setCard({ kind, src, status: 'loading' });
    aiBusyRef.current = true;
    try {
      const cmd = command ? COMMANDS[command] : { todo: 'todo', improve: 'improve', summarize: 'summarize', continue: 'continue' }[kind];
      const res = await aiAPI.processBlock({ text: src.text.slice(0, 12000), command: cmd });
      const result = (res.data?.result || '').trim();
      if (!result) throw new Error('The AI sent back nothing.');
      const items = kind === 'todo' ? result.split('\n').map(clean).filter(Boolean).slice(0, 20).map((t) => ({ text: t, on: true })) : null;
      setCard({ kind, src, status: 'done', result, items, command });
    } catch (e) {
      setCard({ kind, src, status: 'error', error: e.response?.data?.error || e.message || 'The AI did not answer. Try again.' });
    } finally {
      aiBusyRef.current = false;
    }
  };
  const afterId = () => card?.src?.blockId || editor.document[editor.document.length - 1]?.id;
  const insertBelow = (blocks) => {
    editor.insertBlocks(blocks, afterId(), 'after');
    setCard(null);
  };
  const paragraphs = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => ({ type: 'paragraph', content: [{ type: 'text', text: l, styles: {} }] }));
  const replaceWith = (text) => {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const id = card?.src?.blockId;
    if (!id || !lines.length) return;
    editor.updateBlock(id, { type: 'paragraph', content: [{ type: 'text', text: lines[0], styles: {} }] });
    if (lines.length > 1) editor.insertBlocks(paragraphs(lines.slice(1).join('\n')), id, 'after');
    setCard(null);
  };
  const addAllTasks = async () => {
    const chosen = card.items.filter((i) => i.on);
    if (!chosen.length) return;
    setCard({ ...card, adding: true });
    try {
      for (const it of chosen) await todosAPI.create({ text: it.text.slice(0, 200), priority: 'medium', ...(noteId ? { noteId } : {}) });
      queryClient.invalidateQueries({ queryKey: ['todos'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setCard({ ...card, adding: false, added: chosen.length });
    } catch {
      setCard({ ...card, adding: false, error: 'Could not add the tasks.' });
    }
  };
  const flip = (i) => setCard({ ...card, items: card.items.map((x, j) => (j === i ? { ...x, on: !x.on } : x)) });

  const getCustomSlashMenuItems = (query) => {
    const defaultItems = getDefaultReactSlashMenuItems(editor);
    const icon = (I, color) => <I size={16} style={{ color }} />;
    const aiItems = [
      { title: 'AI Action items', onItemClick: () => runAi('todo'), aliases: ['ai-todo', 'todo', 'actions', 'tasks', 'ai'], group: 'AI', icon: icon(CheckSquare, '#6366f1'), subtext: 'Pull tasks out of this note.' },
      { title: 'AI Improve writing', onItemClick: () => runAi('improve'), aliases: ['ai-improve', 'improve', 'rewrite', 'rephrase', 'ai'], group: 'AI', icon: icon(Wand2, '#6366f1'), subtext: 'Clearer, shorter, fix grammar.' },
      { title: 'AI Summarize', onItemClick: () => runAi('summarize'), aliases: ['ai-summarize', 'summarize', 'sum', 'ai'], group: 'AI', icon: icon(Sparkles, '#6366f1'), subtext: 'A short summary of this block.' },
      { title: 'AI Continue writing', onItemClick: () => runAi('continue'), aliases: ['ai-continue', 'continue', 'write', 'ai'], group: 'AI', icon: icon(Sparkles, '#ec4899'), subtext: 'Write the next sentences.' },
    ];
    return filterSuggestionItems(guest ? defaultItems : [...defaultItems, ...aiItems], query);
  };

  const getNoteLinkItems = async (query) => {
    if (Date.now() - linkCache.current.at > 5000) {
      try {
        const { data } = await notesAPI.getAll({ sort: 'updated', limit: 200 });
        linkCache.current = { at: Date.now(), notes: data.notes || [] };
      } catch { /* keep whatever we had */ }
    }
    const raw = String(query || '').replace(/\]\]?$/, '').trim();
    const q = raw.toLowerCase();
    const mine = linkCache.current.notes.filter((n) => n.id !== noteId && (n.title || 'Untitled').toLowerCase().includes(q));
    mine.sort((a, b) => ((b.title || '').toLowerCase().startsWith(q) ? 1 : 0) - ((a.title || '').toLowerCase().startsWith(q) ? 1 : 0));
    const items = mine.slice(0, 8).map((n) => ({
      title: n.title || 'Untitled',
      group: 'Link to a note',
      onItemClick: () => editor.insertInlineContent([{ type: 'link', href: `/notes/${n.id}`, content: n.title || 'Untitled' }, ' ']),
    }));
    if (raw && !linkCache.current.notes.some((n) => (n.title || '').toLowerCase() === q)) {
      items.push({
        title: `Create a note called “${raw}”`,
        group: 'Link to a note',
        onItemClick: async () => {
          try {
            const r = await notesAPI.create({ title: raw, content: '' });
            linkCache.current.at = 0;
            editor.insertInlineContent([{ type: 'link', href: `/notes/${r.data.note.id}`, content: raw }, ' ']);
            queryClient.invalidateQueries({ queryKey: ['notes'] });
          } catch { /* nothing is inserted if the note could not be made */ }
        },
      });
    }
    return items;
  };

  const onLinkClick = (e) => {
    const a = e.target?.closest?.('a');
    const m = a && /^\/notes\/([\w-]+)$/.exec(a.getAttribute('href') || '');
    if (m) { e.preventDefault(); e.stopPropagation(); navigate(`/notes/${m[1]}`); }
  };

  const title = { todo: 'Action items', improve: 'Improve writing', summarize: 'Summary', continue: 'Continue writing' }[card?.kind];
  const dark = theme === 'dark' || theme === 'midnight' || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);

  return (
    <div className="block-editor-container" onClickCapture={onLinkClick} style={{ padding: '0 24px', flex: 1, height: '100%', overflowY: 'auto', cursor: editable ? 'text' : 'default' }}>
      <BlockNoteView
        editor={editor}
        editable={editable}
        onChange={handleChange}
        theme={dark ? 'dark' : 'light'}
        slashMenu={false}
        formattingToolbar={false}
      >
        <SuggestionMenuController triggerCharacter={'/'} getItems={async (query) => getCustomSlashMenuItems(query)} />
        {!guest && <SuggestionMenuController triggerCharacter={'@'} getItems={getNoteLinkItems} />}
        {formattingToolbar && editable && <FormattingToolbarController formattingToolbar={Toolbar} />}
      </BlockNoteView>
      {!guest && <Backlinks noteId={noteId} />}

      {card && (
        <div className={`pb-aicard ${card.kind}`} role="dialog" aria-label={title}>
          <div className="pb-aicard-head">
            <b>{card.kind === 'todo' && card.status === 'done' ? `${title} from this ${card.src.scope === 'note' ? 'note' : 'text'}` : title}</b>
            {card.kind === 'todo' && card.items && <span className="n">{card.items.length} found</span>}
            <span className="grow" />
            <button type="button" aria-label="Close" onClick={() => setCard(null)}><X size={14} /></button>
          </div>

          {card.status === 'loading' && <p className="pb-aicard-msg"><Loader2 size={15} className="pb-spin" /> Working on it…</p>}
          {card.status === 'error' && <p className="pb-aicard-msg err" role="alert">{card.error}</p>}

          {card.status === 'done' && card.kind === 'todo' && (
            <>
              <div className="pb-aicard-items">
                {card.items.map((it, i) => (
                  <label key={i} className={it.on ? 'on' : ''}><input type="checkbox" checked={it.on} onChange={() => flip(i)} /><span>{it.text}</span></label>
                ))}
                {card.items.length === 0 && <p className="pb-aicard-msg">No tasks found in this text.</p>}
              </div>
              {card.added ? <p className="pb-aicard-msg ok" role="status">Added {card.added} task{card.added === 1 ? '' : 's'}{noteId ? ' and linked them to this note' : ''}.</p> : (
                <div className="pb-aicard-actions">
                  <button type="button" className="primary" disabled={card.adding || !card.items.some((i) => i.on)} onClick={addAllTasks}>{card.adding ? 'Adding…' : card.items.every((i) => i.on) ? 'Add all as tasks' : 'Add selected as tasks'}</button>
                  <button type="button" onClick={() => insertBelow(card.items.filter((i) => i.on).map((i) => ({ type: 'checkListItem', content: [{ type: 'text', text: i.text, styles: {} }] })))}>Insert as checklist</button>
                  <button type="button" onClick={() => setCard(null)}>Dismiss</button>
                </div>
              )}
            </>
          )}

          {card.status === 'done' && card.kind !== 'todo' && (
            <>
              {card.kind === 'improve' ? (
                <div className="pb-aicard-cmp">
                  <div><span className="lab">Before</span><p>{card.src.text}</p></div>
                  <div className="after"><span className="lab">After</span><p>{card.result}</p></div>
                </div>
              ) : <div className="pb-aicard-cmp one"><div className="after"><p>{card.result}</p></div></div>}
              <div className="pb-aicard-actions">
                {card.kind === 'improve' && <button type="button" className="primary" onClick={() => replaceWith(card.result)}>Replace</button>}
                <button type="button" className={card.kind === 'improve' ? '' : 'primary'} onClick={() => insertBelow(paragraphs(card.result))}>Insert below</button>
                {card.kind === 'improve' && <><button type="button" onClick={() => runAi('improve', card.src, 'shorter')}>Shorter</button><button type="button" onClick={() => runAi('improve', card.src, 'simpler')}>Simpler</button></>}
                <button type="button" onClick={() => runAi(card.kind, card.src, card.command)}>Try again</button>
                <button type="button" onClick={() => setCard(null)}>Discard</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
