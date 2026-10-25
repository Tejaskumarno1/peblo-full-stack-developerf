import { useEffect, useMemo, useRef, useState } from 'react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
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
import { createCollab } from '../utils/collab';
import { setNoteLive } from '../utils/noteSync';
import Backlinks from './Backlinks';
import { useAuth } from '../context/AuthContext';
import './blockEditor.css';

// A picture, video, audio clip or file picked from the computer becomes a data address inside the note
// (pictures are shrunk first). Bigger than 4 MB is refused with a message instead of silently bloating the note.
// The editor shows a small notice while a picture is being converted and stored, and says plainly when it could not be.
const tell = (state, message) => window.dispatchEvent(new CustomEvent('pb-upload', { detail: { state, message } }));
async function uploadFile(file) {
  tell('working', /^image\//.test(file.type) ? 'Converting the picture to WebP…' : 'Adding the file…');
  try {
    const a = await fileToAttachment(file);
    tell('done', a.isImage ? `Picture added (${Math.max(1, Math.round(a.size / 1024))} KB)` : 'File added');
    return a.url;
  } catch (e) {
    tell('error', e?.message || 'That file could not be added.');
    throw e;
  }
}

// Find in the open note (Ctrl+F). Matches are painted with the browser's highlight feature, so the note itself is never changed.
function FindBar({ root, onClose }) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const [count, setCount] = useState(0);
  const ranges = useRef([]);
  const input = useRef(null);
  useEffect(() => {
    input.current?.focus(); input.current?.select();
    return () => { try { CSS.highlights.delete('pb-find'); CSS.highlights.delete('pb-find-cur'); } catch { /* not supported */ } };
  }, []);
  useEffect(() => {
    const el = root.current?.querySelector('.bn-editor');
    ranges.current = [];
    if (el && q) {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const ql = q.toLowerCase();
      let n;
      while ((n = walker.nextNode())) {
        const t = n.nodeValue.toLowerCase();
        let i = t.indexOf(ql);
        while (i >= 0 && ranges.current.length < 500) {
          const r = new Range(); r.setStart(n, i); r.setEnd(n, i + q.length); ranges.current.push(r);
          i = t.indexOf(ql, i + q.length);
        }
      }
    }
    try { CSS.highlights.set('pb-find', new Highlight(...ranges.current)); } catch { /* not supported */ }
    setCount(ranges.current.length); setIdx(0);
  }, [q, root]);
  useEffect(() => {
    const r = ranges.current[idx];
    try {
      if (!r) { CSS.highlights.delete('pb-find-cur'); return; }
      CSS.highlights.set('pb-find-cur', new Highlight(r));
      r.startContainer.parentElement?.scrollIntoView({ block: 'center' });
    } catch { /* not supported */ }
  }, [idx, count]);
  const step = (d) => { if (count) setIdx((i) => (i + d + count) % count); };
  return (
    <div className="pb-find" role="search">
      <input ref={input} aria-label="Find in this note" placeholder="Find in this note" value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') { e.preventDefault(); onClose(); } }} />
      <span className="n">{q ? (count ? `${idx + 1} of ${count}` : 'No matches') : ''}</span>
      <button type="button" aria-label="Previous match" onClick={() => step(-1)}>↑</button>
      <button type="button" aria-label="Next match" onClick={() => step(1)}>↓</button>
      <button type="button" aria-label="Close find" onClick={onClose}>✕</button>
    </div>
  );
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
  const ar = /^crop=([\d.]+)$/.exec(p.name || '');
  if (ar) q.push(`ar=${ar[1]}`);
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
    if (b.type === 'image' && b.props?.url) return { ...b, props: { ...b.props, name: /^crop=/.test(b.props.name || '') ? (b.props.caption || '') : b.props.name, url: withLayout(b.props) }, children };
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
    if (b.type === 'image' && typeof b.props?.url === 'string' && /#(?:pw|ta|ar)=/.test(b.props.url)) {
      const [u, ...h] = b.props.url.split('#');
      const q = new URLSearchParams(h.join('#'));
      const pw = Number(q.get('pw'));
      const ta = q.get('ta');
      const ar = Number(q.get('ar'));
      return { ...b, props: { ...b.props, url: u, ...(ar > 0 ? { name: `crop=${ar}`, caption: b.props.caption || b.props.name || '' } : {}), ...(pw > 0 ? { previewWidth: pw } : {}), ...(['left', 'center', 'right'].includes(ta) ? { textAlignment: ta } : {}) }, children };
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
      {[['orig', 'Original shape', ''], ['sq', 'Crop to a square', 'crop=1'], ['43', 'Crop to 4:3', 'crop=1.333'], ['169', 'Crop to 16:9', 'crop=1.778']].map(([k, tip, v]) => (
        <Btn key={'c' + k} mainTooltip={tip} icon={tag({ orig: '◻', sq: '1:1', 43: '4:3', 169: '16:9' }[k])} isSelected={(b.props.name || '') === v || (!v && !/^crop=/.test(b.props.name || ''))} onClick={() => set({ name: v })} />
      ))}
      <Btn key="f" mainTooltip="Full width, on its own line" icon={tag('Full')} isSelected={!pw} onClick={() => set({ previewWidth: undefined, textAlignment: 'center' })} />
    </>
  );
}
const Toolbar = () => <FormattingToolbar>{[...getFormattingToolbarItems(), <ImageTools key="imagetools" />]}</FormattingToolbar>;

// Ready-made starting points, offered in the slash menu.
const TEMPLATES = {
  'Meeting notes': '## Meeting\n\n**Date:** \n\n**People:** \n\n## Agenda\n\n- \n\n## Notes\n\n- \n\n## Decisions\n\n- \n\n## Action items\n\n- [ ] \n',
  'Daily plan': '## Top 3 today\n\n- [ ] \n- [ ] \n- [ ] \n\n## Schedule\n\n- \n\n## Notes\n\n',
  'Project brief': '## Goal\n\n\n## Why it matters\n\n\n## Scope\n\n- \n\n## Milestones\n\n- [ ] \n\n## Risks\n\n- \n',
  'Study notes': '## Topic\n\n## Key ideas\n\n- \n\n## Examples\n\n## Questions to revisit\n\n- \n\n## Summary\n\n',
};
const CALLOUTS = [['💡', 'tip', 'Callout: tip'], ['⚠️', 'warn', 'Callout: warning'], ['✅', 'ok', 'Callout: done'], ['ℹ️', 'info', 'Callout: info']];
const RECENT_KEY = 'peblo-slash-recent';
const readRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } };
const remember = (title) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([title, ...readRecent().filter((t) => t !== title)].slice(0, 3))); } catch { /* ignore */ } };

const clean = (l) => l.replace(/^\s*(?:[-*•]\s*(?:\[[ xX]?\]\s*)?|\d+[.)]\s+)/, '').trim();

function BlockEditorInner({ resetEpoch = 0, initialContent, onChange, editable = true, formattingToolbar = true, noteId, guest = false, focusMode = false, mentions = true, fullPage = false, themeOverride, collab, onCollabFail, onCollabState }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const linkCache = useRef({ at: 0, notes: [] });
  const taskCache = useRef({ at: 0, tasks: [] });
  // Live co-editing (Yjs): when `collab` is given, the document is shared with everyone else on this note.
  // The room is created once per mount; the page remounts the editor (key) to switch notes.
  const [rt] = useState(() => (collab ? createCollab(collab) : null));
  const [live, setLive] = useState({ connected: false, ready: false });
  const editor = useCreateBlockNote({
    uploadFile,
    ...(rt ? { collaboration: { provider: rt.provider, fragment: rt.doc.getXmlFragment('document-store'), user: rt.user, showCursorLabels: 'activity' } } : {}),
  });
  const { theme } = useAuth();
  const loadingRef = useRef(!!rt); // a live document is not edited until it is in step with the server
  const changeSequenceRef = useRef(0);
  const [card, setCard] = useState(null); // the AI result card
  const aiBusyRef = useRef(false);
  const rootRef = useRef(null);
  const [notice, setNotice] = useState(null); // {state, message} about a picture being added
  const [lightbox, setLightbox] = useState(null); // address of the picture shown full size
  const [findOpen, setFindOpen] = useState(false);

  useEffect(() => {
    let timer;
    const on = (e) => {
      clearTimeout(timer);
      setNotice(e.detail);
      if (e.detail.state !== 'working') timer = setTimeout(() => setNotice(null), e.detail.state === 'error' ? 6000 : 2200);
    };
    window.addEventListener('pb-upload', on);
    return () => { window.removeEventListener('pb-upload', on); clearTimeout(timer); };
  }, []);

  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape' && lightbox) { setLightbox(null); return; }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f' && rootRef.current?.contains(document.activeElement)) {
        e.preventDefault(); setFindOpen(true);
      }
    };
    const open = () => setFindOpen(true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('pb-find-open', open);
    return () => { document.removeEventListener('keydown', key, true); window.removeEventListener('pb-find-open', open); };
  }, [lightbox]);

  // Typewriter focus: the block you are writing in stays bright and centred, the rest fades.
  const [curId, setCurId] = useState(null);
  useEffect(() => {
    if (!focusMode) { setCurId(null); return undefined; }
    const mark = () => {
      try {
        const id = editor.getTextCursorPosition().block.id;
        setCurId(id);
        rootRef.current?.querySelector(`.bn-block-outer[data-id="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch { /* no cursor yet */ }
    };
    mark();
    const off = editor.onSelectionChange(mark);
    return () => { if (typeof off === 'function') off(); };
  }, [focusMode, editor]);

  useEffect(() => {
    try { if (localStorage.getItem('peblo-debug') === '1') window.__pebloEditor = editor; } catch { /* ignore */ }
  }, [editor]);

  // ---------- live co-editing: connect, fill an empty document once, and report the connection ----------
  const resetEpochRef = useRef(resetEpoch);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const liveRef = useRef(false);
  const connRef = useRef(false);
  liveRef.current = live.connected && live.ready;
  useEffect(() => {
    if (!rt) return undefined;
    const { provider, doc } = rt;
    const meta = doc.getMap('meta');
    let seedText = null;
    let busy = false;
    let dead = false;
    let readyTimer;
    // Tell the page the text the shared document holds now (after a reset, or after a dropped connection came back).
    const flush = async () => {
      if (dead || !onChangeRef.current) return;
      try { const md = await editor.blocksToMarkdownLossy(toStorage(editor.document)); if (dead) return; rt.announce(md); onChangeRef.current?.(md); } catch { /* the next edit tells it */ }
    };
    let everReady = false;
    const markReady = () => {
      loadingRef.current = true; // what arrives from the server is not an edit to save
      everReady = true;
      setLive((s) => ({ ...s, ready: true }));
      readyTimer = setTimeout(() => {
        loadingRef.current = false;
        // After the room was reset (the note was changed another way) the page still holds the old text: tell it the new one.
        if (resetEpochRef.current > 0) void flush();
      }, 400);
    };
    const check = async () => {
      if (dead || busy || !provider.synced) return;
      if (meta.get('seeded') === true) { markReady(); busy = true; return; }
      if (seedText === null) return;
      busy = true;
      try {
        loadingRef.current = true;
        const blocks = seedText.trim() ? fromStorage(await editor.tryParseMarkdownToBlocks(seedText)) : null;
        if (dead) return;
        if (meta.get('seeded') !== true) {
          if (blocks && blocks.length) editor.replaceBlocks(editor.document, blocks);
          doc.transact(() => meta.set('seeded', true));
        }
        markReady();
      } catch (err) {
        console.error('Could not fill the shared document:', err);
        busy = false;
      }
    };
    const onSeed = (text) => { seedText = text; void check(); };
    const onStatus = ({ status }) => { connRef.current = status === 'connected'; setLive((s) => ({ ...s, connected: status === 'connected' })); };
    // The connection came back: everything typed meanwhile has merged, so the saved copy catches up.
    const onSync = (isSynced) => { if (isSynced && everReady) setTimeout(() => { void flush(); }, 300); };
    const onClose = (ev) => {
      const code = ev?.code;
      if (code === 4002 || code === 4003) {
        provider.disconnect();
        window.dispatchEvent(new CustomEvent('pb-collab-closed', { detail: { code, noteId, share: collab?.share } }));
      }
    };
    provider.on('seed', onSeed);
    provider.on('sync', check);
    provider.on('sync', onSync);
    provider.on('status', onStatus);
    provider.on('connection-close', onClose);
    meta.observe(check);
    const dbg = (m) => { try { if (localStorage.getItem('peblo-debug') === '1') console.log('[collab]', m); } catch { /* ignore */ } };
    dbg('connect ' + (noteId || collab?.share));
    provider.on('connection-close', (ev) => dbg('close code ' + ev?.code));
    rt.connect();
    try { if (localStorage.getItem('peblo-debug') === '1') window.__pebloCollab = rt; } catch { /* ignore */ }
    // Could not reach the live server (a firewall, an old server): fall back to ordinary editing after a while.
    const giveUp = setTimeout(() => { if (!dead && !provider.synced) onCollabFail?.(); }, 12000);
    return () => {
      dead = true;
      clearTimeout(giveUp); clearTimeout(readyTimer);
      provider.off('seed', onSeed); provider.off('sync', check); provider.off('sync', onSync); provider.off('status', onStatus); provider.off('connection-close', onClose);
      meta.unobserve(check);
      dbg('release');
      rt.release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt]);

  // Saves from this note use the live rules only while the connection is up and the document is in step.
  useEffect(() => {
    if (!rt || !noteId) return undefined;
    setNoteLive(noteId, live.connected && live.ready ? 'live' : 'wait');
    return () => setNoteLive(noteId, false);
  }, [rt, noteId, live.connected, live.ready]);
  // 'live' | 'wait' | 'off' for pages that do their own saving (the share page)
  useEffect(() => { onCollabState?.(!rt ? 'off' : live.connected && live.ready ? 'live' : 'wait'); }, [rt, live.connected, live.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    async function loadContent() {
      if (rt) return; // a live document is filled from the server's copy instead
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
    // While a live connection is down, edits stay in the shared document and sync when it returns. Saving the page's own
    // copy now could overwrite what other people typed meanwhile.
    if (rt && !connRef.current) return;
    const sequence = ++changeSequenceRef.current;
    const markdown = await editor.blocksToMarkdownLossy(toStorage(editor.document));
    // Markdown conversion is asynchronous. Ignore an older conversion that
    // finishes after a newer edit, otherwise autosave can roll content back.
    if (sequence !== changeSequenceRef.current) return;
    if (rt && liveRef.current) rt.announce(markdown); // the server learns this text is ours before it is saved
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
    // Callouts are a quote that starts with a symbol (so they survive as plain Markdown); templates drop a ready layout in.
    const insertCallout = (emoji) => {
      const cur = editor.getTextCursorPosition().block;
      const content = [{ type: 'text', text: `${emoji} `, styles: {} }];
      if (cur.type === 'paragraph' && !textOf(cur.content).trim()) { editor.updateBlock(cur, { type: 'quote', content }); editor.setTextCursorPosition(cur, 'end'); return; }
      const [made] = editor.insertBlocks([{ type: 'quote', content }], cur, 'after');
      if (made) editor.setTextCursorPosition(made, 'end');
    };
    const insertTemplate = async (md) => {
      const blocks = fromStorage(await editor.tryParseMarkdownToBlocks(md));
      const cur = editor.getTextCursorPosition().block;
      const empty = cur.type === 'paragraph' && !textOf(cur.content).trim();
      editor.insertBlocks(blocks, cur, 'after');
      if (empty) editor.removeBlocks([cur]);
    };
    const extra = [
      ...CALLOUTS.map(([emoji, kind, title]) => ({ title, onItemClick: () => insertCallout(emoji), aliases: ['callout', 'box', 'note', kind], group: 'Callouts', icon: <span style={{ fontSize: 15 }}>{emoji}</span>, subtext: 'A highlighted box for something to notice.' })),
      { title: 'Table of contents', onItemClick: () => {
        const heads = editor.document.filter((b) => b.type === 'heading').map((b) => textOf(b.content).trim()).filter(Boolean);
        const cur = editor.getTextCursorPosition().block;
        if (!heads.length) { editor.insertBlocks([{ type: 'paragraph', content: 'Add some headings first, then insert the table of contents.' }], cur, 'after'); return; }
        editor.insertBlocks(heads.map((h) => ({ type: 'bulletListItem', content: h })), cur, 'after');
      }, aliases: ['toc', 'contents', 'outline'], group: 'Insert', icon: <span style={{ fontSize: 15 }}>📑</span>, subtext: 'A list of this note\'s headings.' },
      ...(guest || !noteId ? [] : [{ title: 'Task from this line', onItemClick: async () => {
        const cur = editor.getTextCursorPosition().block;
        const prev = editor.getTextCursorPosition().prevBlock;
        const text = (textOf(cur.content).trim() || textOf(prev?.content).trim()).slice(0, 200);
        if (!text) return;
        try { await todosAPI.create({ text, priority: 'medium', noteId }); queryClient.invalidateQueries({ queryKey: ['todos'] }); window.dispatchEvent(new CustomEvent('pb-upload', { detail: { state: 'done', message: 'Task added' } })); } catch { /* nothing to do */ }
      }, aliases: ['task', 'todo', 'to-do'], group: 'Insert', icon: <span style={{ fontSize: 15 }}>✅</span>, subtext: 'Turn this line (or the one above) into a task linked to this note.' }]),
      { title: 'Current time', onItemClick: () => editor.insertInlineContent([`${new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} `]), aliases: ['time', 'now', 'clock'], group: 'Insert', icon: <span style={{ fontSize: 15 }}>🕒</span>, subtext: 'Type the time as text.' },
      { title: "Today's date", onItemClick: () => editor.insertInlineContent([`${new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} `]), aliases: ['date', 'today', 'now'], group: 'Insert', icon: <span style={{ fontSize: 15 }}>📅</span>, subtext: 'Type today as text.' },
      ...(guest ? [] : [{ title: 'Link to a note', onItemClick: () => editor.getExtension(SuggestionMenu)?.openSuggestionMenu('@'), aliases: ['link', 'note', 'mention', 'wiki'], group: 'Insert', icon: <span style={{ fontSize: 15 }}>🔗</span>, subtext: 'Pick one of your notes (or type [[).' }]),
      ...Object.entries(TEMPLATES).map(([name, md]) => ({ title: `Template: ${name}`, onItemClick: () => insertTemplate(md), aliases: ['template', name.toLowerCase()], group: 'Templates', icon: <span style={{ fontSize: 15 }}>📄</span>, subtext: 'A ready layout to fill in.' })),
    ];
    const all = [...defaultItems, ...extra, ...(guest ? [] : aiItems)].map((it) => ({ ...it, onItemClick: () => { remember(it.title); it.onItemClick(); } }));
    const recent = query ? [] : readRecent().map((t) => all.find((i) => i.title === t)).filter(Boolean).map((i) => ({ ...i, group: 'Recent' }));
    return filterSuggestionItems([...recent, ...all], query);
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
    // open tasks that match (only when a note is open, so the task can be tied to it)
    if (noteId) {
      try {
        if (Date.now() - taskCache.current.at > 5000) {
          const { data } = await todosAPI.getAll({});
          taskCache.current = { at: Date.now(), tasks: (data.todos || []).filter((t) => !t.completed) };
        }
        const tasks = taskCache.current.tasks.filter((t) => String(t.text || '').toLowerCase().includes(q)).slice(0, 5);
        for (const t of tasks) {
          items.push({
            title: String(t.text).slice(0, 80),
            group: 'Link a task',
            subtext: t.noteId === noteId ? 'Already linked to this note' : 'Ties the task to this note',
            onItemClick: async () => {
              editor.insertInlineContent([`☐ ${String(t.text).slice(0, 120)} `]);
              if (t.noteId !== noteId) {
                try { await todosAPI.update(t.id, { noteId }); taskCache.current.at = 0; queryClient.invalidateQueries({ queryKey: ['todos'] }); } catch { /* the text is still there */ }
              }
            },
          });
        }
      } catch { /* notes still work without tasks */ }
    }
    return items;
  };

  // Code blocks get a Copy chip in their top-right corner (drawn by CSS, so the block itself is untouched).
  const copyCode = (e) => {
    const cb = e.target?.closest?.('.bn-block-content[data-content-type="codeBlock"]');
    if (!cb) return false;
    const r = cb.getBoundingClientRect();
    if (e.clientX < r.right - 84 || e.clientY > r.top + 38) return false;
    e.preventDefault(); e.stopPropagation();
    const text = (cb.querySelector('code') || cb).innerText;
    navigator.clipboard?.writeText(text).catch(() => {});
    setNotice({ state: 'done', message: 'Code copied' });
    setTimeout(() => setNotice(null), 1600);
    return true;
  };

  // Callouts: a quote that starts with a symbol is shown as a coloured box.
  // (the editor rewrites attributes it did not set itself, so this is a decoration it keeps)
  useEffect(() => {
    const plugin = new Plugin({
      key: new PluginKey('pb-callouts'),
      props: {
        decorations(state) {
          const out = [];
          state.doc.descendants((node, pos) => {
            if (node.type.name === 'image') {
              const m = /^crop=([\d.]+)$/.exec(node.attrs?.name || '');
              if (m) out.push(Decoration.node(pos, pos + node.nodeSize, { 'data-crop': m[1], style: `--pb-ar:${m[1]}` }));
              return false;
            }
            if (node.type.name !== 'quote') return true;
            const t = node.textContent.trim();
            const k = CALLOUTS.find(([emoji]) => t.startsWith(emoji) || t.startsWith(emoji.replace('\uFE0F', '')));
            if (k) out.push(Decoration.node(pos, pos + node.nodeSize, { 'data-callout': k[1] }));
            return false;
          });
          return DecorationSet.create(state.doc, out);
        },
      },
    });
    editor.registerExtension({ key: 'pb-callouts', prosemirrorPlugins: [plugin] });
    return () => { try { editor.unregisterExtension('pb-callouts'); } catch { /* editor already gone */ } };
    // registered again once a live document is ready: the shared document sets the editor up afresh when it first syncs
  }, [editor, live.ready]);

  const onLinkClick = (e) => {
    if (copyCode(e)) return;
    const pic = e.target?.closest?.('img.bn-visual-media');
    if (pic && !editable) { e.preventDefault(); setLightbox(pic.currentSrc || pic.src); return; }
    const a = e.target?.closest?.('a');
    const m = a && /^\/notes\/([\w-]+)$/.exec(a.getAttribute('href') || '');
    if (m) { e.preventDefault(); e.stopPropagation(); navigate(`/notes/${m[1]}`); }
  };

  const title = { todo: 'Action items', improve: 'Improve writing', summarize: 'Summary', continue: 'Continue writing' }[card?.kind];
  const dark = themeOverride ? themeOverride === 'dark' : theme === 'dark' || theme === 'midnight' || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);

  return (
    <div ref={rootRef} data-live={rt && live.ready && live.connected ? '1' : undefined} className={`block-editor-container${focusMode ? ' pb-focus' : ''}${fullPage ? ' pb-editor-full-page' : ''}`} onClickCapture={onLinkClick} onDoubleClick={(e) => { const pic = e.target?.closest?.('img.bn-visual-media'); if (pic) setLightbox(pic.currentSrc || pic.src); }} style={{ padding: '0 24px', flex: fullPage ? 'none' : 1, height: fullPage ? 'auto' : '100%', overflowY: fullPage ? 'visible' : 'auto', cursor: editable ? 'text' : 'default' }}>
      <BlockNoteView
        editor={editor}
        editable={editable && (!rt || live.ready)}
        onChange={handleChange}
        theme={dark ? 'dark' : 'light'}
        slashMenu={false}
        formattingToolbar={false}
      >
        <SuggestionMenuController triggerCharacter={'/'} getItems={async (query) => getCustomSlashMenuItems(query)} />
        {!guest && <SuggestionMenuController triggerCharacter={'@'} getItems={getNoteLinkItems} />}
        {formattingToolbar && editable && <FormattingToolbarController formattingToolbar={Toolbar} />}
      </BlockNoteView>
      {!guest && <Backlinks noteId={noteId} mentions={mentions} />}

      {focusMode && curId && <style>{`.pb-focus .bn-block-outer:not([data-id="${curId}"]):not(:has([data-id="${curId}"])) { opacity: .28; transition: opacity .2s; }`}</style>}
      {rt && (!live.ready || !live.connected) && <div className="pb-notice working" role="status" data-testid="collab-status">{live.ready ? 'Reconnecting… your changes are kept and will sync.' : 'Connecting to live editing…'}</div>}
      {notice && <div className={`pb-notice ${notice.state}`} role={notice.state === 'error' ? 'alert' : 'status'}>{notice.message}</div>}
      {findOpen && <FindBar root={rootRef} onClose={() => setFindOpen(false)} />}
      {lightbox && (
        <div className="pb-lightbox" role="dialog" aria-label="Picture" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
          <button type="button" aria-label="Close picture" onClick={() => setLightbox(null)}>✕</button>
        </div>
      )}

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

/**
 * The note editor. A saved note is opened as a live room (Yjs) by default, so everyone editing it, on any device or
 * through a share link, sees each other's typing as it happens and nothing is ever lost to a conflict.
 * If the live server cannot be reached, it falls back to ordinary editing with the safe-save merge.
 */
export default function BlockEditor(props) {
  const { noteId, guest, editable = true, collab, onCollabFail } = props;
  const { user } = useAuth();
  const [off, setOff] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const flagOff = useMemo(() => { try { return localStorage.getItem('peblo-collab') === 'off'; } catch { return false; } }, []);
  const auto = !guest && !!noteId && noteId !== '__draft__' && editable !== false;
  const resolved = off || flagOff ? undefined : (collab || (auto ? { noteId, name: user?.name || 'Me' } : undefined));
  useEffect(() => {
    const on = (e) => {
      const d = e.detail || {};
      if (d.code !== 4002) return;
      if ((noteId && d.noteId === noteId) || (collab?.share && d.share === collab.share)) setEpoch((n) => n + 1); // the note was changed another way: start the room again from its new text
    };
    window.addEventListener('pb-collab-closed', on);
    return () => window.removeEventListener('pb-collab-closed', on);
  }, [noteId, collab?.share]);
  return <BlockEditorInner key={`${noteId || collab?.share || ''}:${epoch}${off ? 'p' : ''}`} {...props} resetEpoch={epoch} collab={resolved} onCollabFail={() => { setOff(true); onCollabFail?.(); }} />;
}

