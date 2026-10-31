import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { BlockNoteView } from '@blocknote/mantine';
import {
  useCreateBlockNote, SuggestionMenuController, getDefaultReactSlashMenuItems,
  FormattingToolbarController, FormattingToolbar, TextAlignButton, SideMenuController, SideMenu, TableHandlesController, TableHandle, getFormattingToolbarItems, useBlockNoteEditor, useComponentsContext,
} from '@blocknote/react';
import { filterSuggestionItems, SuggestionMenu } from '@blocknote/core/extensions';
import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import '@blocknote/mantine/style.css';
import { Sparkles, CheckSquare, Wand2, X, Loader2, HelpCircle, SpellCheck, Minus, Plus, ChevronDown, Images, Smile, Video as VideoIcon, Mic, Keyboard, Crop, Download, Trash2, ImageUp, Captions, Presentation, FileText, FileSpreadsheet, File as FileGlyph, Lightbulb, TriangleAlert, CircleCheck, Info, ListTree, Clock, CalendarDays, Link2, LayoutTemplate } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { aiAPI, notesAPI, todosAPI } from '../api/index';
import { fileToAttachment } from '../utils/imageData';
import { createCollab } from '../utils/collab';
import PresenceBar from './Presence';
import CommentsDock from './CommentsDock';
import EditedBy from './EditedBy';
import ColorTool from './ColorPanel';
import TableMenu from './TableMenu';
import TableTools from './TableTools';
import { newMarks, noteTable, insertMarkers, splitMarkers, applyMarks, createMetaStore, exportRows } from '../utils/tableMeta';
import { makeTablePlugin } from '../utils/tablePlugin';
import './tableMeta.css';
import Reactions from './Reactions';
import Pointers from './Pointers';
import { Ic } from '../utils/icons';
import MediaTools, { groupOf } from './MediaTools';
import FileTools from './FileTools';
import { docFileSpec } from './DocFile';
import { packProps, unpackProps, isFileUrl } from '../utils/docFiles';
import './docfile.css';
import FindBar from './FindBar';
import BlockMenu from './BlockMenu';
import { commentTarget } from '../utils/comments';
import { setNoteLive, peekExternalEdit, clearExternalEdit } from '../utils/noteSync';
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
    if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name || 'That file'} is over 25 MB`); // refuse before the browser tries to decode it
    const a = await fileToAttachment(file);
    tell('done', a.isImage ? `Picture added (${Math.max(1, Math.round(a.size / 1024))} KB)` : 'File added');
    return a.url;
  } catch (e) {
    tell('error', e?.message || 'That file could not be added.');
    throw e;
  }
}

/* ---------------------------------------------------------------------------
   Notes are stored as Markdown. Markdown has no video, audio, file or toggle, so those blocks are written
   as a plain link / a "▸ " bullet and turned back into real blocks when the note is opened.
   ------------------------------------------------------------------------------ */
const textOf = (content) => (Array.isArray(content) ? content.map((c) => (c.type === 'link' ? textOf(c.content) : c.text || '')).join('') : typeof content === 'string' ? content : '');

// A picture's size and side are kept in the address ("...#pw=320&ta=right") because Markdown has nowhere else for them.
// A picture made smaller than the column sits on its own row (left, centre or right); it never floats.
const withLayout = (p) => {
  const q = [];
  const pwOk = Number.isFinite(p.previewWidth) && p.previewWidth > 0;
  if (pwOk) q.push(`pw=${Math.round(p.previewWidth)}`);
  if (p.textAlignment && p.textAlignment !== 'left') q.push(`ta=${p.textAlignment}`);
  const ar = /^crop=(\d+(?:\.\d+)?)$/.exec(p.name || '');
  if (ar) q.push(`ar=${ar[1]}`);
  const g = groupOf(p.url);
  if (g.gl === 'grid') q.push('gl=grid', `gc=${g.gc}`); else if (g.gl === 'row') q.push('gl=row');
  // the width of the column the size was chosen in ("rc") lets other screens keep the same proportions; "rp" is the size it was chosen at
  const had = new URLSearchParams(String(p.url).split('#').slice(1).join('#'));
  if (pwOk) {
    const col = document.querySelector('.bn-editor > .bn-block-group')?.clientWidth || document.querySelector('.bn-editor')?.clientWidth || 0;
    const same = Number(had.get('rp')) === Math.round(p.previewWidth) && Number(had.get('rc')) > 0;
    const rc = same ? Number(had.get('rc')) : col;
    if (rc > 0) q.push(`rc=${Math.round(rc)}`, `rp=${Math.round(p.previewWidth)}`);
  }
  const base = String(p.url).split('#')[0];
  return q.length ? `${base}#${q.join('&')}` : base;
};

// Pictures, files and documents live in notes as blocks; the document block (PowerPoint, Word, Excel, PDF and other files) is added to the standard set.
const schema = BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, docfile: docFileSpec() } });

// `ctx` (from newMarks) collects each table's saved settings, to be written after the table by insertMarkers.
function toStorage(blocks, ctx, store) {
  return blocks.map((b) => {
    if (b.type === 'table' && ctx && b.content?.type === 'tableContent') {
      noteTable(ctx, b, store);
      return { ...b, content: { ...b.content, rows: exportRows(b) }, children: b.children?.length ? toStorage(b.children, ctx, store) : [] };
    }
    const children = b.children?.length ? toStorage(b.children, ctx, store) : [];
    if (b.type === 'docfile') {
      if (!b.props?.url) return { ...b, type: 'paragraph', props: {}, content: [], children };
      return { id: b.id, type: 'image', props: { url: packProps(b.props), caption: b.props.name || 'file' }, children };
    }
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
    if (b.type === 'image' && isFileUrl(b.props?.url)) {
      const u = unpackProps(b.props.url);
      return { type: 'docfile', props: { url: u.url, name: u.name === 'file' && b.props.caption ? b.props.caption : u.name, size: u.size, meta: u.meta, frame: u.frame, download: u.download, pages: u.pages, caption: u.caption }, children };
    }
    if (b.type === 'image' && /^data:(?!image\/)/.test(b.props?.url || '')) {
      const url = b.props.url;
      const name = b.props.caption || b.props.name || 'file';
      const m = /^data:(video|audio)\//.exec(url);
      if (m) return { type: m[1], props: { url, name, showPreview: true }, children };
      return { type: 'file', props: { url, name }, children };
    }
    if (b.type === 'image' && /^https?:\/\/\S+\.(?:mp4|webm|ogv|mov|m4v)(?:[?#]|$)/i.test(b.props?.url || '')) return { type: 'video', props: { url: b.props.url.split('#')[0], name: b.props.caption || b.props.name || 'video', showPreview: true }, children };
    if (b.type === 'image' && typeof b.props?.url === 'string' && /#(?:pw|ta|ar|gl|gc|rc|rp)=/.test(b.props.url)) {
      const [u, ...h] = b.props.url.split('#');
      const q = new URLSearchParams(h.join('#'));
      const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : 0; }; // NaN, negative, Infinity and absurd sizes count as unset
      const pw = num(q.get('pw'), 1, 10000);
      const ta = q.get('ta');
      const ar = num(q.get('ar'), 0.1, 10);
      const gl = q.get('gl');
      const kp = [];
      if (gl === 'grid') kp.push('gl=grid', `gc=${Math.min(4, Math.max(2, Number(q.get('gc')) || 2))}`); else if (gl === 'row') kp.push('gl=row');
      const rcN = num(q.get('rc'), 1, 20000); const rpN = num(q.get('rp'), 1, 10000);
      if (rcN > 0 && rpN > 0) kp.push(`rc=${Math.round(rcN)}`, `rp=${Math.round(rpN)}`);
      const keep = kp.length ? `#${kp.join('&')}` : '';
      return { ...b, props: { ...b.props, url: u + keep, ...(ar > 0 ? { name: `crop=${ar}`, caption: b.props.caption || b.props.name || '' } : {}), ...(pw > 0 ? { previewWidth: pw } : {}), ...(['left', 'center', 'right'].includes(ta) ? { textAlignment: ta } : {}) }, children };
    }
    if (b.type === 'bulletListItem' && Array.isArray(b.content) && b.content[0]?.type === 'text' && /^▸\s/.test(b.content[0].text || '')) {
      const first = { ...b.content[0], text: b.content[0].text.replace(/^▸\s+/, '') };
      return { type: 'toggleListItem', props: {}, content: [first, ...b.content.slice(1)], children };
    }
    return { ...b, children };
  });
}

// Markdown to blocks, with each table's saved settings put back (see utils/tableMeta).
async function parseMd(editor, text, store) {
  const { text: plain, marks } = splitMarkers(text);
  return applyMarks(fromStorage(await editor.tryParseMarkdownToBlocks(plain)), marks, store);
}

// Callouts, cropped pictures and picture groups are drawn with decorations (the editor rewrites attributes it did not set itself, so a decoration is what it keeps).
// The plugin is handed to the editor when it is created: registering it later rebuilds the editor's plugin views, which switched off Undo in a live note.
function makeDecoPlugin() {
  let lastDoc = null; let lastSet = null; // the walk below is the whole document: only redo it when the document itself changed (not on every cursor move)
  return new Plugin({
    key: new PluginKey('pb-callouts'),
    props: {
      decorations(state) {
        if (state.doc === lastDoc && lastSet) return lastSet;
        const out = [];
        state.doc.descendants((node, pos) => {
          if (node.type.name === 'blockGroup') {
            // pictures side by side: two or more in a row of blocks share a layout (stack is the plain default)
            const run = [];
            const flush = () => {
              if (run.length > 1) {
                const g = groupOf(run[0].url);
                if (g.gl !== 'stack') for (const r of run) out.push(Decoration.node(r.pos, r.pos + r.size, { 'data-gl': g.gl, 'data-gn': String(Math.min(run.length, 6)), 'data-gc': String(g.gc) }));
              }
              run.length = 0;
            };
            node.forEach((child, offset) => {
              const content = child.firstChild;
              if (content && content.type.name === 'image' && child.type.name === 'blockContainer') run.push({ pos: pos + 1 + offset + 1, size: content.nodeSize, url: content.attrs?.url });
              else flush();
            });
            flush();
            return true;
          }
          if (node.type.name === 'image') {
            const m = /^crop=(\d+(?:\.\d+)?)$/.exec(node.attrs?.name || '');
            if (m) out.push(Decoration.node(pos, pos + node.nodeSize, { 'data-crop': m[1], style: `--pb-ar:${m[1]}` }));
            return false;
          }
          if (node.type.name !== 'quote') return true;
          const t = node.textContent.trim();
          const k = CALLOUTS.find(([emoji]) => t.startsWith(emoji) || t.startsWith(emoji.replace('\uFE0F', '')));
          if (k) out.push(Decoration.node(pos, pos + node.nodeSize, { 'data-callout': k[1] }));
          return false;
        });
        lastDoc = state.doc; lastSet = DecorationSet.create(state.doc, out);
        return lastSet;
      },
    },
  });
}

// Undo in a live note is the shared document's own history. Comments and reactions add editor plugins after the note opens;
// that rebuilds the plugin views, and the history was switched off with them (Ctrl Z did nothing). Keep it alive for the life of the editor.
function undoManagerOf(editor) {
  try {
    const st = editor.prosemirrorState;
    return st.plugins.find((p) => p.key === 'y-undo$')?.getState(st)?.undoManager || null;
  } catch { return null; }
}
function keepUndo(editor) {
  const um = undoManagerOf(editor);
  if (um && !um.__pbKeep) { um.__pbKeep = true; um.destroy = () => {}; }
  return um;
}

// The bar that appears over a clicked picture: a short bar of its own (size, side, shape, caption, replace, download, delete),
// not the 21-button text toolbar. It sits centred on the picture and is kept inside the note panel (see boundedToolbar below).
const PIC_SIZES = [['small', 'Small picture', 'S', 0.25], ['medium', 'Medium picture', 'M', 0.45], ['large', 'Large picture', 'L', 0.7]];
const PIC_SHAPES = [['orig', 'Original shape', '◻', ''], ['sq', 'Crop to a square', '1:1', 'crop=1'], ['43', 'Crop to 4:3', '4:3', 'crop=1.333'], ['169', 'Crop to 16:9', '16:9', 'crop=1.778']];
function PictureBar({ b }) {
  const editor = useBlockNoteEditor();
  const Components = useComponentsContext();
  const [panel, setPanel] = useState(null); // 'shape' | null: a second row under the buttons
  const fileRef = useRef(null);
  useEffect(() => { setPanel(null); }, [b.id]);
  if (!Components) return null;
  const Btn = Components.FormattingToolbar.Button;
  const width = () => editor.domElement?.clientWidth || 700;
  const set = (props) => editor.updateBlock(b, { props });
  const pw = b.props.previewWidth;
  const pct = (p) => Math.round(width() * p);
  const near = (p) => pw && Math.abs(pw - pct(p)) < 12;
  const tag = (t) => <span style={{ fontWeight: 800, fontSize: 12 }}>{t}</span>;
  const replace = async (file) => {
    if (!file) return;
    try { const url = await uploadFile(file); set({ url, name: '' }); } catch { /* the notice says why */ }
  };
  const download = () => {
    const a = document.createElement('a');
    a.href = String(b.props.url || '').split('#')[0];
    a.download = (b.props.caption || 'picture').replace(/[^\w.-]+/g, '-').slice(0, 60) || 'picture';
    document.body.appendChild(a); a.click(); a.remove();
  };
  const shapeOn = PIC_SHAPES.find(([, , , v]) => (b.props.name || '') === v)?.[0] || 'orig';
  return (
    <FormattingToolbar>
      {[
        ...PIC_SIZES.map(([k, tip, t, p]) => <Btn key={k} mainTooltip={tip} icon={tag(t)} isSelected={near(p)} onClick={() => set({ previewWidth: pct(p) })} />),
        <Btn key="full" mainTooltip="Full width, on its own line" icon={tag('Full')} isSelected={!pw} onClick={() => set({ previewWidth: undefined, textAlignment: 'center' })} />,
        <TextAlignButton key="al" textAlignment="left" />,
        <TextAlignButton key="ac" textAlignment="center" />,
        <TextAlignButton key="ar" textAlignment="right" />,
        <Btn key="shape" mainTooltip="Crop and shape" icon={<Crop size={15} />} isSelected={panel === 'shape'} onClick={() => setPanel(panel === 'shape' ? null : 'shape')} />,
        <Btn key="cap" mainTooltip="Caption and alt text" icon={<Captions size={15} />} isSelected={!!b.props.caption} onClick={() => window.dispatchEvent(new CustomEvent('pb-media', { detail: { act: 'caption', id: b.id } }))} />,
        <Btn key="rep" mainTooltip="Replace picture" icon={<ImageUp size={15} />} onClick={() => fileRef.current?.click()} />,
        <Btn key="dl" mainTooltip="Download picture" icon={<Download size={15} />} onClick={download} />,
        <Btn key="del" mainTooltip="Delete picture" icon={<Trash2 size={15} />} onClick={() => { try { editor.removeBlocks([b.id]); } catch { /* already gone */ } }} />,
        <input key="file" ref={fileRef} type="file" accept="image/*" hidden data-testid="pic-replace-input" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; replace(f); }} />,
        ...(panel === 'shape' ? [<div key="shapes" className="pb-picbar-row" role="group" aria-label="Crop and shape">
          {PIC_SHAPES.map(([k, tip, t, v]) => <Btn key={k} mainTooltip={tip} icon={tag(t)} isSelected={shapeOn === k} onClick={() => set({ name: v })} />)}
          <Btn key="crop" mainTooltip="Crop, rotate or flip this picture" icon={<Crop size={15} />} onClick={() => window.dispatchEvent(new CustomEvent('pb-media', { detail: { act: 'crop', id: b.id } }))} />
        </div>] : []),
      ]}
    </FormattingToolbar>
  );
}
// Comment on the selected words, or suggest new words for them (the comments drawer opens with the words attached).

const CommentsOn = createContext(false);
function CommentTools() {
  const on = useContext(CommentsOn);
  const editor = useBlockNoteEditor();
  const Components = useComponentsContext();
  if (!on || !Components) return null;
  const Btn = Components.FormattingToolbar.Button;
  const go = (mode) => window.dispatchEvent(new CustomEvent('pb-comment-start', { detail: { quote: (editor.getSelectedText() || '').trim(), mode } }));
  return (
    <>
      <Btn key="cm" mainTooltip="Comment on this text" icon={<Ic name="comment" size={16} />} onClick={() => go('comment')} />
      <Btn key="sg" mainTooltip="Suggest new words for this text" icon={<Ic name="suggest" size={16} />} onClick={() => go('suggest')} />
    </>
  );
}
// Ask: one button at the end of the selection bar that opens Explain, Make a task, Quiz me and the writing helpers.
const ASK = [
  { id: 'explain', label: 'Explain', Icon: Sparkles, send: { kind: 'explain' } },
  { id: 'task', label: 'Make a task', Icon: CheckSquare, send: { kind: 'task' } },
  { id: 'quiz', label: 'Quiz me', Icon: HelpCircle, send: { kind: 'quiz' } },
  { id: 'grammar', label: 'Fix grammar', Icon: SpellCheck, send: { kind: 'improve', command: 'grammar' } },
  { id: 'shorter', label: 'Make shorter', Icon: Minus, send: { kind: 'improve', command: 'shorter' } },
  { id: 'longer', label: 'Make longer', Icon: Plus, send: { kind: 'improve', command: 'longer' } },
];
function AskTool() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const editor = useBlockNoteEditor();
  const sel = (editor.getSelectedText?.() || '').trim();
  useEffect(() => {
    if (!open) return undefined;
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const w = 220, h = ASK.length * 38 + 14;
      const top = r.bottom + 10 + h > window.innerHeight ? Math.max(8, r.top - 10 - h) : r.bottom + 10;
      setPos({ top, left: Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) });
    }
    const close = (e) => { if (e.type === 'keydown' && e.key !== 'Escape') return; if (e.type === 'mousedown' && (e.target.closest?.('.pb-sel-menu') || e.target.closest?.('.pb-sel-ask'))) return; setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  if (!sel || sel.length < 3) return null;
  return (
    <div className="pb-sel-ask" onMouseDown={(e) => e.preventDefault()}>
      <button ref={btnRef} type="button" className={`pb-sel-ask-btn${open ? ' on' : ''}`} data-testid="ask-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Sparkles size={14} />Ask<ChevronDown size={13} />
      </button>
      {open && pos && createPortal(
        <div className="pb-sel-menu" role="menu" data-testid="ask-menu" style={{ top: pos.top, left: pos.left }} onMouseDown={(e) => e.preventDefault()}>
          {ASK.map(({ id, label, Icon, send }) => (
            <button key={id} type="button" role="menuitem" data-testid={`ask-${id}`} onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent('pb-ai-run', { detail: send })); }}>
              <Icon size={14} />{label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
// Which block is selected (one block only), and its picture on screen.
const oneBlock = (editor) => {
  try {
    const sel = editor.getSelection();
    const blocks = sel ? sel.blocks : [editor.getTextCursorPosition().block];
    return blocks.length === 1 ? blocks[0] : null;
  } catch { return null; }
};
// The nearest ancestor that scrolls the note (the panel the toolbar must stay inside); null means the page itself.
const scrollerOf = (el) => {
  for (let p = el; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.clientHeight > 0) return p;
  }
  return null;
};
// Floating-ui middleware for the selection toolbar: placed above the selection (above, and centred on, a picture), flipped below the
// selection when there is no room above, shifted into the note panel, and hidden when the selection has scrolled out of the panel.
// A picture at the top of the note puts the bar on the picture itself, so it never covers the lines below.
const boundedToolbar = (editor) => ({
  name: 'pbBounded',
  fn({ rects, elements }) {
    const fl = elements.floating; const dom = editor.domElement;
    if (!fl || !dom) return {};
    const b = oneBlock(editor);
    const img = b && b.type === 'image' ? dom.querySelector(`.bn-block-outer[data-id="${b.id}"] .bn-visual-media-wrapper, .bn-block-outer[data-id="${b.id}"] img.bn-visual-media`) : null;
    const sc = scrollerOf(dom.closest('.block-editor-container')?.parentElement); const box = sc ? sc.getBoundingClientRect() : { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight };
    const vb = { top: Math.max(box.top, 0), bottom: Math.min(box.bottom, window.innerHeight), left: Math.max(box.left, 0), right: Math.min(box.right, window.innerWidth) };
    const r = img ? img.getBoundingClientRect() : { top: rects.reference.y, left: rects.reference.x, bottom: rects.reference.y + rects.reference.height, width: rects.reference.width };
    fl.style.maxWidth = `${Math.max(160, vb.right - vb.left - 16)}px`;
    const fw = rects.floating.width; const fh = rects.floating.height;
    const gap = img ? 8 : 10;
    let y = r.top - fh - gap;
    if (y < vb.top + 6) y = img ? Math.max(r.top, vb.top) + 8 : r.bottom + gap;
    y = Math.min(Math.max(y, vb.top + 6), vb.bottom - fh - 6);
    let x = img ? r.left + r.width / 2 - fw / 2 : r.left;
    x = Math.min(Math.max(x, vb.left + 8), vb.right - fw - 8);
    fl.style.visibility = r.bottom < vb.top + 4 || r.top > vb.bottom - 4 ? 'hidden' : '';
    return { x, y };
  },
});
// Keeps the toolbar following the picture or words while the note scrolls, the window resizes or the picture changes size.
const followSelection = (editor) => (reference, floating, update) => {
  const on = () => update();
  document.addEventListener('scroll', on, true);
  window.addEventListener('resize', on);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(on) : null;
  if (ro && editor.domElement) ro.observe(editor.domElement);
  const mo = new MutationObserver(on);
  if (editor.domElement) mo.observe(editor.domElement, { subtree: true, attributes: true, attributeFilter: ['data-preview-width', 'style'] });
  return () => { document.removeEventListener('scroll', on, true); window.removeEventListener('resize', on); ro?.disconnect(); mo.disconnect(); };
};
const Toolbar = () => {
  const editor = useBlockNoteEditor();
  const b = oneBlock(editor);
  if (b && b.type === 'image') return <PictureBar b={b} />;
  return <FormattingToolbar>{[...getFormattingToolbarItems().map((it) => (it.key === 'colorStyleButton' ? <ColorTool key="colors" /> : it)), <CommentTools key="comments" />, <AskTool key="ask" />]}</FormattingToolbar>;
};

// Ready-made starting points, offered in the slash menu.
const TEMPLATES = {
  'Meeting notes': '## Meeting\n\n**Date:** \n\n**People:** \n\n## Agenda\n\n- \n\n## Notes\n\n- \n\n## Decisions\n\n- \n\n## Action items\n\n- [ ] \n',
  'Daily plan': '## Top 3 today\n\n- [ ] \n- [ ] \n- [ ] \n\n## Schedule\n\n- \n\n## Notes\n\n',
  'Project brief': '## Goal\n\n\n## Why it matters\n\n\n## Scope\n\n- \n\n## Milestones\n\n- [ ] \n\n## Risks\n\n- \n',
  'Study notes': '## Topic\n\n## Key ideas\n\n- \n\n## Examples\n\n## Questions to revisit\n\n- \n\n## Summary\n\n',
};
const CALLOUT_ICON = { tip: Lightbulb, warn: TriangleAlert, ok: CircleCheck, info: Info };
const CALLOUTS = [['💡', 'tip', 'Callout: tip'], ['⚠️', 'warn', 'Callout: warning'], ['✅', 'ok', 'Callout: done'], ['ℹ️', 'info', 'Callout: info']];
const RECENT_KEY = 'peblo-slash-recent';
const readRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } };
const remember = (title) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([title, ...readRecent().filter((t) => t !== title)].slice(0, 3))); } catch { /* ignore */ } };

const clean = (l) => l.replace(/^\s*(?:[-*•]\s*(?:\[[ xX]?\]\s*)?|\d+[.)]\s+)/, '').trim();

const CHANGE_DEBOUNCE_MS = 200; // quiet time before the typed text is turned into Markdown (see handleChange)

function BlockEditorInner({ resetEpoch = 0, initialContent, onChange, editable = true, formattingToolbar = true, noteId, guest = false, focusMode = false, typewriter = null, mentions = true, fullPage = false, themeOverride, collab, onCollabFail, onCollabState }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const linkCache = useRef({ at: 0, notes: [] });
  const taskCache = useRef({ at: 0, tasks: [] });
  // Live co-editing (Yjs): when `collab` is given, the document is shared with everyone else on this note.
  // The room is created once per mount; the page remounts the editor (key) to switch notes.
  const [rt] = useState(() => (collab ? createCollab(collab) : null));
  // a share-link guest changed their name or colour: tell the others straight away, no reload
  useEffect(() => {
    if (!rt) return undefined;
    const on = (e) => {
      const { name, color } = e.detail || {};
      if (name) rt.user.name = String(name).slice(0, 40);
      if (/^#[0-9a-f]{6}$/i.test(color || '')) rt.user.color = color;
      try { rt.provider.awareness.setLocalStateField('user', { name: rt.user.name, color: rt.user.color }); } catch { /* gone */ }
    };
    window.addEventListener('pb-identity', on);
    return () => window.removeEventListener('pb-identity', on);
  }, [rt]);
  const [live, setLive] = useState({ connected: false, ready: false });
  const [metaStore] = useState(() => createMetaStore(rt?.doc)); // table settings Markdown cannot hold; shared with everyone in a live note
  const [decoExt] = useState(() => ({ key: 'pb-callouts', prosemirrorPlugins: [makeDecoPlugin(), makeTablePlugin(metaStore)] }));
  const editor = useCreateBlockNote({
    schema,
    uploadFile,
    extensions: [decoExt],
    ...(rt ? { collaboration: { provider: rt.provider, fragment: rt.doc.getXmlFragment('document-store'), user: rt.user, showCursorLabels: 'activity' } } : {}),
  });
  useMemo(() => keepUndo(editor), [editor]);
  useEffect(() => { keepUndo(editor); }, [editor, rt]);
  const { theme } = useAuth();
  const loadingRef = useRef(!!rt); // a live document is not edited until it is in step with the server
  const changeSequenceRef = useRef(0);
  const [card, setCard] = useState(null); // the AI result card
  const aiBusyRef = useRef(false);
  const rootRef = useRef(null);
  // the selection toolbar is kept inside the note panel and follows its picture or words (see boundedToolbar)
  const toolbarFloat = useMemo(() => ({ useFloatingOptions: { strategy: 'fixed', middleware: [boundedToolbar(editor)], whileElementsMounted: followSelection(editor) } }), [editor]);
  const [fitRoot, setFitRoot] = useState(null);
  useEffect(() => { if (rootRef.current !== fitRoot) setFitRoot(rootRef.current); });
  // A picture keeps the proportions it was given in the owner's column when the column here is narrower or wider (a shared page,
  // a phone). Pictures never float (blockEditor.css), so nothing can sit beside one.
  // BlockNote rewrites the classes of a block, so the blocks are named in a style sheet of their own.
  useEffect(() => {
    const root = fitRoot; if (!root) return undefined;
    const sheet = document.createElement('style'); sheet.setAttribute('data-pic-fit', '');
    document.head.appendChild(sheet);
    let timer = 0; let last = ''; let again = 0;
    const fit = () => {
      timer = 0;
      const col = root.querySelector('.bn-editor > .bn-block-group')?.clientWidth || root.querySelector('.bn-editor')?.clientWidth || root.clientWidth; if (!col) return;
      const parts = [];
      root.querySelectorAll('.bn-block-content[data-content-type="image"][data-preview-width]').forEach((c) => {
        const w0 = Number(c.getAttribute('data-preview-width')) || 0;
        const id = c.closest('.bn-block-outer')?.getAttribute('data-id');
        if (!id || !(w0 > 0)) return;
        // keep the owner's proportions on this screen: a picture half the owner's column is half of this one
        const q = new URLSearchParams(String(c.querySelector('img')?.getAttribute('src') || '').split('#').slice(1).join('#'));
        const rcN = Number(q.get('rc'));
        const rc = Number.isFinite(rcN) && rcN > 0 && rcN < 20000 ? rcN : (guest ? 1090 : 0);
        const w = rc > 0 && Math.abs(rc - col) > 8 ? Math.floor(Math.min(col, w0 * col / rc) * 0.92) : w0;
        const sel = `.block-editor-container .bn-block-outer[data-id="${id}"]`;
        // a picture nearly as wide as the column keeps its saved width (the column caps it); only a clearly narrower one is rescaled
        if (w >= col * 0.66 || col - w < 295) return;
        if (w !== w0) parts.push(`${sel} .bn-visual-media-wrapper, ${sel} .bn-file-block-content-wrapper, ${sel} img.bn-visual-media { width: ${w}px !important; max-width: 100% !important; }`);
      });
      const text = parts.join('\n');
      if (text !== last) { last = text; sheet.textContent = text; if (again < 4) { again += 1; timer = setTimeout(fit, 60); } } else again = 0; // the new sizes move other pictures, so look once more
    };
    const queue = () => { if (!timer) timer = setTimeout(fit, 30); };
    const mo = new MutationObserver(queue); mo.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-preview-width'] });
    const ro = new ResizeObserver(queue); ro.observe(root);
    queue();
    return () => { mo.disconnect(); ro.disconnect(); if (timer) clearTimeout(timer); sheet.remove(); };
  }, [fitRoot, guest]);
  // A picture smaller than the column leaves empty room on its row. Clicking that room puts the caret on the line below the picture
  // (a new empty line is added when the next block is not text), so typing there is never lost.
  useEffect(() => {
    const root = fitRoot; if (!root || editable === false) return undefined;
    const down = (e) => {
      if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey) return;
      const content = e.target?.closest?.('.bn-block-content[data-content-type="image"]');
      if (!content || !root.contains(content) || content.hasAttribute('data-gl')) return;
      if (e.target.closest('.bn-visual-media-wrapper, .bn-file-block-content-wrapper, .bn-add-file-button, button, input, a')) return;
      const id = content.closest('.bn-block-outer')?.getAttribute('data-id'); if (!id) return;
      try {
        const blk = editor.getBlock(id); if (!blk) return;
        e.preventDefault(); e.stopPropagation();
        let next = editor.getNextBlock(blk);
        if (!next || !Array.isArray(next.content)) { editor.insertBlocks([{ type: 'paragraph' }], blk, 'after'); next = editor.getNextBlock(blk); }
        if (next) { editor.setTextCursorPosition(next, 'start'); editor.focus(); }
      } catch { /* leave the click alone */ }
    };
    root.addEventListener('mousedown', down, true);
    return () => root.removeEventListener('mousedown', down, true);
  }, [fitRoot, editable, editor]);
  const [notice, setNotice] = useState(null); // {state, message} about a picture being added
  const [lightbox, setLightbox] = useState(null); // address of the picture shown full size
  const [findOpen, setFindOpen] = useState(false);
  const [findReplace, setFindReplace] = useState(false);

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
      const mod = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey;
      const k = e.key.toLowerCase();
      if (mod && (k === 'f' || k === 'h')) {
        // inside the note, or with nothing else holding the keyboard (a reader on a shared page); not while typing in another field
        const a = document.activeElement;
        const elsewhere = a && a !== document.body && !rootRef.current?.contains(a) && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
        if (elsewhere) return;
        if (k === 'h' && editable === false) return;
        e.preventDefault(); setFindReplace(k === 'h'); setFindOpen(true);
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && editable !== false && rootRef.current?.contains(document.activeElement)) {
        e.preventDefault(); // Alt Up / Alt Down move the block
        try { if (e.key === 'ArrowUp') editor.moveBlocksUp(); else editor.moveBlocksDown(); } catch { /* nothing to move */ }
      }
    };
    const open = () => { setFindReplace(false); setFindOpen(true); };
    document.addEventListener('keydown', key, true);
    window.addEventListener('pb-find-open', open);
    return () => { document.removeEventListener('keydown', key, true); window.removeEventListener('pb-find-open', open); };
  }, [lightbox, editable, editor]);

  // Typewriter focus: the block you are writing in stays bright and centred, the rest fades.
  // focusMode fades every block but the one being written in; typewriter keeps that block centred (when typewriter is not given, focusMode does both)
  const centre = typewriter === null ? focusMode : !!typewriter;
  const [curId, setCurId] = useState(null);
  useEffect(() => {
    if (!focusMode && !centre) { setCurId(null); return undefined; }
    const mark = () => {
      try {
        const id = editor.getTextCursorPosition().block.id;
        if (focusMode) setCurId(id);
        if (centre) rootRef.current?.querySelector(`.bn-block-outer[data-id="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch { /* no cursor yet */ }
    };
    if (!focusMode) setCurId(null);
    mark();
    const off = editor.onSelectionChange(mark);
    return () => { if (typeof off === 'function') off(); };
  }, [focusMode, centre, editor]);

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
      try { const mc = newMarks(); const md = insertMarkers(await editor.blocksToMarkdownLossy(toStorage(editor.document, mc, metaStore)), mc); if (dead) return; rt.announce(md); onChangeRef.current?.(md); } catch { /* the next edit tells it */ }
    };
    let everReady = false;
    let pushedExternal = false;
    const markReady = () => {
      loadingRef.current = true; // what arrives from the server is not an edit to save
      everReady = true;
      try { keepUndo(editor)?.clear(); } catch { /* none */ } // filling the document is not something Ctrl Z may take back
      setLive((s) => ({ ...s, ready: true }));
      readyTimer = setTimeout(() => {
        loadingRef.current = false;
        // After the room was reset (the note was changed another way) the page still holds the old text: tell it the new one.
        if (resetEpochRef.current > 0 || pushedExternal) void flush();
      }, 400);
    };
    // Text put in from outside (a template, find and replace, a restored version): the room still holds the old text, so
    // write the new text into it now. It then reaches everyone in the room and is saved like any other edit.
    const pushExternal = async () => {
      const text = noteId ? peekExternalEdit(noteId) : null;
      if (text === null) return;
      clearExternalEdit(noteId);
      loadingRef.current = true;
      const blocks = text.trim() ? await parseMd(editor, text, metaStore) : [];
      if (dead || !blocks.length) return;
      editor.replaceBlocks(editor.document, blocks);
      pushedExternal = true;
    };
    const check = async () => {
      if (dead || busy || !provider.synced) return;
      if (meta.get('seeded') === true) {
        if (noteId && peekExternalEdit(noteId) !== null) {
          busy = true;
          try { await pushExternal(); } catch (err) { console.error('Could not put the new text into the shared document:', err); }
          if (!dead) markReady();
          return;
        }
        markReady(); busy = true; return; // nothing from outside: the room is ready as it is
      }
      if (seedText === null) return;
      busy = true;
      try {
        loadingRef.current = true;
        const blocks = seedText.trim() ? await parseMd(editor, seedText, metaStore) : null;
        if (dead) return;
        if (meta.get('seeded') !== true) {
          if (blocks && blocks.length) editor.replaceBlocks(editor.document, blocks);
          doc.transact(() => meta.set('seeded', true));
        }
        if (noteId && peekExternalEdit(noteId) !== null) await pushExternal();
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
      if (noteId) clearExternalEdit(noteId); // no room to put outside text into: initialContent already has it
      if (!initialContent) return;
      try {
        loadingRef.current = true; // reading a note in is not an edit to save
        const parsed = await parseMd(editor, initialContent, metaStore);
        editor.replaceBlocks(editor.document, parsed);
        setTimeout(() => { loadingRef.current = false; }, 0);
      } catch (err) {
        loadingRef.current = false;
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

  // Turning the whole document into Markdown costs time in proportion to the note's size (about 0.17 s on a 2 MB note), so doing
  // it on every keystroke made typing in big notes lag. The conversion now waits until typing pauses for CHANGE_DEBOUNCE_MS,
  // and is run at once (flushChange) when the editor loses focus, the tab is hidden, Ctrl+S is pressed, or something fires
  // the 'peblo-flush-editor' event. What is saved is the same Markdown as before; only the moment it is produced moves.
  const dirtyRef = useRef(false);
  const changeTimerRef = useRef(null);
  const pendingFnRef = useRef(null);
  const flushChange = () => {
    if (changeTimerRef.current) { clearTimeout(changeTimerRef.current); changeTimerRef.current = null; }
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    const deliver = pendingFnRef.current;
    if (!deliver || loadingRef.current || aiBusyRef.current) return;
    if (rt && !connRef.current) return;
    const sequence = ++changeSequenceRef.current;
    // take the document now (not after the await) so an edit made while converting is a new change of its own
    const marksCtx = newMarks();
    const blocks = toStorage(editor.document, marksCtx, metaStore);
    void (async () => {
      const markdown = insertMarkers(await editor.blocksToMarkdownLossy(blocks), marksCtx); // may be synchronous or a promise depending on the BlockNote version
      // Markdown conversion is asynchronous. Ignore an older conversion that
      // finishes after a newer edit, otherwise autosave can roll content back.
      if (sequence !== changeSequenceRef.current) return;
      if (rt && liveRef.current) rt.announce(markdown); // the server learns this text is ours before it is saved
      deliver(markdown);
    })().catch(() => { /* the next edit converts again */ });
  };
  useEffect(() => metaStore.subscribe((mine) => { if (mine && !loadingRef.current) handleChangeRef.current?.(); }), [metaStore]); // a table setting changed: save it like a typed edit
  const flushRef = useRef(flushChange);
  flushRef.current = flushChange;
  const handleChangeRef = useRef(null);
  const handleChange = () => {
    checkDoubleBracket();
    if (!onChange || loadingRef.current || aiBusyRef.current) return;
    // While a live connection is down, edits stay in the shared document and sync when it returns. Saving the page's own
    // copy now could overwrite what other people typed meanwhile.
    if (rt && !connRef.current) return;
    dirtyRef.current = true;
    pendingFnRef.current = onChange;
    if (changeTimerRef.current) clearTimeout(changeTimerRef.current);
    changeTimerRef.current = setTimeout(() => flushRef.current(), CHANGE_DEBOUNCE_MS);
  };
  handleChangeRef.current = handleChange;
  useEffect(() => {
    const flush = () => flushRef.current();
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) flush(); };
    const root = rootRef.current;
    root?.addEventListener('focusout', flush, true);
    root?.addEventListener('keydown', onKey, true);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    window.addEventListener('peblo-flush-editor', flush);
    return () => {
      root?.removeEventListener('focusout', flush, true);
      root?.removeEventListener('keydown', onKey, true);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('peblo-flush-editor', flush);
      // Leaving the editor: the parents' onChange writes into whichever note is current by now, so an edit still waiting is
      // delivered only by blur (which always comes first when a person clicks elsewhere), never from here.
      if (changeTimerRef.current) { clearTimeout(changeTimerRef.current); changeTimerRef.current = null; }
    };
  }, []);

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
  const COMMANDS = { shorter: 'Rewrite much shorter, keeping the meaning:', simpler: 'Rewrite in simpler, plainer words:', grammar: 'Fix the grammar, spelling and punctuation, changing nothing else, in:', longer: 'Rewrite longer and richer, keeping the meaning:' };
  const KIND_CMD = { explain: 'Explain this simply in 2 to 4 sentences:', quiz: 'Write 3 short quiz questions, each followed by its answer, about:' };
  const runAi = async (kind, source, command) => {
    const src = source || sourceFor(kind);
    if (!src.text) { setCard({ kind, src, status: 'error', error: 'Type or select some text first, then run this again.' }); return; }
    setCard({ kind, src, status: 'loading', command });
    aiBusyRef.current = true;
    try {
      const cmd = command ? COMMANDS[command] : KIND_CMD[kind] || { todo: 'todo', improve: 'improve', summarize: 'summarize', continue: 'continue' }[kind];
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
  // The Ask menu in the selection bar sends its choice here (see AskTool).
  const runAiRef = useRef(runAi);
  runAiRef.current = runAi;
  useEffect(() => {
    const onAsk = (e) => {
      if (!rootRef.current?.contains(document.activeElement) && !rootRef.current?.querySelector('.bn-toolbar')) return;
      const { kind, command } = e.detail || {};
      if (kind === 'task') {
        const src = sourceFor('task');
        if (!src.text) { setCard({ kind: 'todo', src, status: 'error', error: 'Select some words first, then choose Make a task.' }); return; }
        setCard({ kind: 'todo', src, status: 'done', items: [{ text: src.text.length > 120 ? `${src.text.slice(0, 117)}...` : src.text, on: true }] });
        return;
      }
      runAiRef.current(kind, undefined, command);
    };
    window.addEventListener('pb-ai-run', onAsk);
    return () => window.removeEventListener('pb-ai-run', onAsk);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
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
    const defaultItems = getDefaultReactSlashMenuItems(editor).filter((i) => i.title !== 'Video');
    const icon = (I, color) => <I size={16} style={{ color }} />;
    const media = (act) => { let refId; try { refId = editor.getTextCursorPosition().block.id; } catch { /* none */ } window.dispatchEvent(new CustomEvent('pb-media', { detail: { act, refId } })); };
    const mediaItems = editable === false ? [] : [
      { title: 'Pictures', onItemClick: () => media('pictures'), aliases: ['pic', 'picture', 'photo', 'photos', 'image', 'images'], badge: '/pic', group: 'Media', icon: <Images size={16} />, subtext: 'Pick many at once' },
      { title: 'GIF', onItemClick: () => media('gif'), aliases: ['gif', 'animated', 'meme'], badge: '/gif', group: 'Media', icon: <Smile size={16} />, subtext: 'Upload or paste a link' },
      { title: 'Video', onItemClick: () => media('video'), aliases: ['vid', 'movie', 'mp4', 'clip'], badge: '/vid', group: 'Media', icon: <VideoIcon size={16} />, subtext: 'Upload or paste a link' },
      { title: 'Voice note', onItemClick: () => media('voice'), aliases: ['mic', 'record', 'audio', 'voice'], badge: '/mic', group: 'Media', icon: <Mic size={16} />, subtext: 'Record a short audio clip' },
      { title: 'Dictate', onItemClick: () => media('dictate'), aliases: ['dictate', 'speech', 'speak', 'type with voice'], badge: '/dict', group: 'Media', icon: <Keyboard size={16} />, subtext: 'Speak and it types for you' },
    ];
    const doc = (kind) => { let refId; try { refId = editor.getTextCursorPosition().block.id; } catch { /* none */ } window.dispatchEvent(new CustomEvent('pb-docfile', { detail: { act: 'add', kind, refId } })); };
    const fileItems = editable === false || guest ? [] : [
      { title: 'Presentation', onItemClick: () => doc('ppt'), aliases: ['ppt', 'pptx', 'powerpoint', 'slides', 'deck', 'keynote'], badge: '/ppt', group: 'Files', icon: <Presentation size={16} style={{ color: '#c4441c' }} />, subtext: 'Show its slides right in the note' },
      { title: 'Document', onItemClick: () => doc('doc'), aliases: ['doc', 'docx', 'word', 'letter', 'contract'], badge: '/doc', group: 'Files', icon: <FileText size={16} style={{ color: '#1f5a8c' }} />, subtext: 'Read a Word file in place' },
      { title: 'Spreadsheet', onItemClick: () => doc('xls'), aliases: ['xls', 'xlsx', 'excel', 'sheet', 'csv', 'spreadsheet'], badge: '/xls', group: 'Files', icon: <FileSpreadsheet size={16} style={{ color: '#1e8e4e' }} />, subtext: 'Look through an Excel sheet' },
      { title: 'PDF', onItemClick: () => doc('pdf'), aliases: ['pdf', 'paper', 'report'], badge: '/pdf', group: 'Files', icon: <FileGlyph size={16} style={{ color: '#a5281b' }} />, subtext: 'Read pages, or show just a few' },
      { title: 'Any other file', onItemClick: () => doc('any'), aliases: ['file', 'attach', 'attachment', 'upload', 'zip'], badge: '/file', group: 'Files', icon: <FileGlyph size={16} />, subtext: 'Keep it with the note to download' },
    ];
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
      const blocks = await parseMd(editor, md, metaStore);
      const cur = editor.getTextCursorPosition().block;
      const empty = cur.type === 'paragraph' && !textOf(cur.content).trim();
      editor.insertBlocks(blocks, cur, 'after');
      if (empty) editor.removeBlocks([cur]);
    };
    const extra = [
      ...CALLOUTS.map(([emoji, kind, title]) => ({ title, onItemClick: () => insertCallout(emoji), aliases: ['callout', 'box', 'note', kind], group: 'Callouts', icon: (() => { const I = CALLOUT_ICON[kind]; return <I size={16} />; })(), subtext: 'A highlighted box for something to notice.' })),
      { title: 'Table of contents', onItemClick: () => {
        const heads = editor.document.filter((b) => b.type === 'heading').map((b) => textOf(b.content).trim()).filter(Boolean);
        const cur = editor.getTextCursorPosition().block;
        if (!heads.length) { editor.insertBlocks([{ type: 'paragraph', content: 'Add some headings first, then insert the table of contents.' }], cur, 'after'); return; }
        editor.insertBlocks(heads.map((h) => ({ type: 'bulletListItem', content: h })), cur, 'after');
      }, aliases: ['toc', 'contents', 'outline'], group: 'Insert', icon: <ListTree size={16} />, subtext: 'A list of this note\'s headings.' },
      ...(guest || !noteId ? [] : [{ title: 'Task from this line', onItemClick: async () => {
        const cur = editor.getTextCursorPosition().block;
        const prev = editor.getTextCursorPosition().prevBlock;
        const text = (textOf(cur.content).trim() || textOf(prev?.content).trim()).slice(0, 200);
        if (!text) return;
        try { await todosAPI.create({ text, priority: 'medium', noteId }); queryClient.invalidateQueries({ queryKey: ['todos'] }); window.dispatchEvent(new CustomEvent('pb-upload', { detail: { state: 'done', message: 'Task added' } })); } catch { /* nothing to do */ }
      }, aliases: ['task', 'todo', 'to-do'], group: 'Insert', icon: <CheckSquare size={16} />, subtext: 'Turn this line (or the one above) into a task linked to this note.' }]),
      { title: 'Current time', onItemClick: () => editor.insertInlineContent([`${new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} `]), aliases: ['time', 'now', 'clock'], group: 'Insert', icon: <Clock size={16} />, subtext: 'Type the time as text.' },
      { title: "Today's date", onItemClick: () => editor.insertInlineContent([`${new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} `]), aliases: ['date', 'today', 'now'], group: 'Insert', icon: <CalendarDays size={16} />, subtext: 'Type today as text.' },
      ...(guest ? [] : [{ title: 'Link to a note', onItemClick: () => editor.getExtension(SuggestionMenu)?.openSuggestionMenu('@'), aliases: ['link', 'note', 'mention', 'wiki'], group: 'Insert', icon: <Link2 size={16} />, subtext: 'Pick one of your notes (or type [[).' }]),
      ...Object.entries(TEMPLATES).map(([name, md]) => ({ title: `Template: ${name}`, onItemClick: () => insertTemplate(md), aliases: ['template', name.toLowerCase()], group: 'Templates', icon: <LayoutTemplate size={16} />, subtext: 'A ready layout to fill in.' })),
    ];
    const all = [...mediaItems, ...fileItems, ...defaultItems.filter((i) => i.group === 'Media'), ...defaultItems.filter((i) => i.group !== 'Media'), ...extra, ...(guest ? [] : aiItems)].map((it) => ({ ...it, onItemClick: () => { remember(it.title); it.onItemClick(); } }));
    const recent = query ? [] : readRecent().map((t) => all.find((i) => i.title === t)).filter(Boolean).map((i) => ({ ...i, group: 'Recent' }));
    const found = filterSuggestionItems([...recent, ...all], query);
    const q = String(query || '').trim().toLowerCase();
    if (!q) return found;
    const rank = (i) => (i.group !== 'Media' && i.group !== 'Files' && String(i.title).toLowerCase() === q ? 0 : 1); // "/table" finds Table before anything that merely mentions it
    return found.map((i, n) => [i, n]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((x) => x[0]);
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

  const onLinkClick = (e) => {
    if (copyCode(e)) return;
    const pic = e.target?.closest?.('img.bn-visual-media');
    if (pic && !editable) { e.preventDefault(); setLightbox(pic.currentSrc || pic.src); return; }
    const a = e.target?.closest?.('a');
    const m = a && /^\/notes\/([\w-]+)$/.exec(a.getAttribute('href') || '');
    if (m) { e.preventDefault(); e.stopPropagation(); navigate(`/notes/${m[1]}`); }
  };

  const title = { todo: 'Action items', improve: card?.command === 'grammar' ? 'Fix grammar' : card?.command === 'shorter' ? 'Make shorter' : card?.command === 'longer' ? 'Make longer' : 'Improve writing', summarize: 'Summary', continue: 'Continue writing', explain: 'Explain', quiz: 'Quiz me' }[card?.kind];
  const target = useMemo(() => (editable !== false ? commentTarget({ noteId, collab }) : null), [noteId, collab?.share, collab?.sid, editable]); // eslint-disable-line react-hooks/exhaustive-deps
  const dark = themeOverride ? themeOverride === 'dark' : theme === 'dark' || theme === 'midnight' || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);

  return (
    <div ref={rootRef} data-live={rt && live.ready && live.connected ? '1' : undefined} className={`block-editor-container${focusMode ? ' pb-focus' : ''}${fullPage ? ' pb-editor-full-page' : ''}`} onClickCapture={onLinkClick} onDoubleClick={(e) => { const pic = e.target?.closest?.('img.bn-visual-media'); if (pic) setLightbox(pic.currentSrc || pic.src); }} style={{ padding: '0 24px', flex: fullPage ? 'none' : 1, height: fullPage ? 'auto' : '100%', overflowY: fullPage ? 'visible' : 'auto', cursor: editable ? 'text' : 'default' }}>
      {(rt || target) && (
        <CommentsDock rt={rt} editor={editor} rootRef={rootRef} target={target} ready={live.ready && live.connected} dark={dark}>
          {rt && <PresenceBar rt={rt} editor={editor} rootRef={rootRef} ready={live.ready && live.connected} />}
        </CommentsDock>
      )}
      {rt && <Pointers rt={rt} rootRef={rootRef} ready={live.ready && live.connected} />}
      {rt && editable && <EditedBy rt={rt} editor={editor} ready={live.ready && live.connected} />}
      {rt && <Reactions rt={rt} editor={editor} rootRef={rootRef} ready={live.ready && live.connected} canReact={editable} dark={dark} />}
      <CommentsOn.Provider value={!!target}>
      <BlockNoteView
        editor={editor}
        editable={editable && (!rt || live.ready)}
        onChange={handleChange}
        theme={dark ? 'dark' : 'light'}
        slashMenu={false}
        formattingToolbar={false}
        sideMenu={false}
        tableHandles={false}
      >
        <SideMenuController sideMenu={(props) => <SideMenu {...props} dragHandleMenu={BlockMenu} />} />
        <SuggestionMenuController triggerCharacter={'/'} getItems={async (query) => getCustomSlashMenuItems(query)} />
        {!guest && <SuggestionMenuController triggerCharacter={'@'} getItems={getNoteLinkItems} />}
        {formattingToolbar && editable && <FormattingToolbarController formattingToolbar={Toolbar} floatingUIOptions={toolbarFloat} />}
        {editable && <TableHandlesController tableHandle={(p) => <TableHandle {...p} tableHandleMenu={TableMenu} />} />}
      </BlockNoteView>
      <TableTools editor={editor} rootRef={rootRef} store={metaStore} editable={editable !== false && (!rt || live.ready)} dark={dark} onEdited={() => handleChangeRef.current?.()} />
      </CommentsOn.Provider>
      {!guest && <Backlinks noteId={noteId} mentions={mentions} />}

      {focusMode && curId && <style>{`.pb-focus .bn-block-outer:not([data-id="${curId}"]):not(:has([data-id="${curId}"])) { opacity: .28; transition: opacity .2s; }`}</style>}
      {rt && (!live.ready || !live.connected) && <div className="pb-notice working" role="status" data-testid="collab-status">{live.ready ? 'Reconnecting… your changes are kept and will sync.' : 'Connecting to live editing…'}</div>}
      {notice && <div className={`pb-notice ${notice.state}`} role={notice.state === 'error' ? 'alert' : 'status'}>{notice.message}</div>}
      <MediaTools editor={editor} rootRef={rootRef} uploadFile={uploadFile} editable={editable !== false} />
      <FileTools editor={editor} rootRef={rootRef} editable={editable !== false && !guest} />
      {findOpen && <FindBar key={findReplace ? 'r' : 'f'} root={rootRef} editor={editor} editable={editable !== false} withReplace={findReplace} onClose={() => { setFindOpen(false); try { editor.focus(); } catch { /* none */ } }} />}
      {lightbox && (
        <div className="pb-lightbox" role="dialog" aria-label="Picture" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
          <button type="button" aria-label="Close picture" onClick={() => setLightbox(null)}><X size={18} /></button>
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

