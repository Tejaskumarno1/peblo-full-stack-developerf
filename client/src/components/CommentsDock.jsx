import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ic, icSvg } from '../utils/icons';
import { createPortal } from 'react-dom';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { commentsApi, findQuote, ago } from '../utils/comments';
import { usePeers } from './Presence';
import { Check, MessageSquare, Send, X as XIcon } from 'lucide-react';

/*
 * The top-right corner of an open note: the comments button (and the presence avatars, passed in as children), the
 * comments drawer, and the yellow marks on the words that have a comment. A suggestion is a comment that carries
 * replacement words; accepting it changes the note through the editor, so everyone sees it at once.
 */

const MENTION_AT = /@([^@\n]{0,24})$/;

function Composer({ mode, quote, people, onSubmit, onCancel, busy, autoFocus, soft, reply }) {
  const [body, setBody] = useState('');
  const [replacement, setReplacement] = useState(mode === 'suggest' ? quote || '' : '');
  const [mentions, setMentions] = useState([]);
  const ta = useRef(null);
  useEffect(() => { if (autoFocus) ta.current?.focus(); }, [autoFocus]);
  const m = MENTION_AT.exec(body);
  const options = m ? people.filter((p) => p.toLowerCase().startsWith(m[1].toLowerCase())).slice(0, 5) : [];
  const pick = (name) => { setBody(body.replace(MENTION_AT, `@${name} `)); setMentions((x) => [...new Set([...x, name])]); ta.current?.focus(); };
  const ok = mode === 'suggest' ? replacement.trim() !== (quote || '').trim() : body.trim().length > 0;
  const send = () => { if (ok && !busy) onSubmit({ body: body.trim(), replacement, mentions: mentions.filter((n) => body.includes('@' + n)) }); };
  return (
    <div className="pb-cform">
      {mode === 'suggest' && (
        <>
          <label className="lbl">Change it to</label>
          <textarea aria-label="Suggested replacement text" value={replacement} onChange={(e) => setReplacement(e.target.value)} rows={2} data-testid="suggest-text" />
        </>
      )}
      <textarea
        ref={ta}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && ((e.ctrlKey || e.metaKey) || (soft && !e.shiftKey && !e.nativeEvent?.isComposing))) { e.preventDefault(); send(); } }}
        placeholder={mode === 'suggest' ? 'Why? (optional)' : reply ? 'Reply. Type @ to mention someone' : 'Write a comment. Type @ to mention someone'}
        rows={3}
        maxLength={2000}
        data-testid="comment-text"
        aria-label={mode === 'suggest' ? 'Reason for the suggestion' : 'Comment'}
      />
      {options.length > 0 && (
        <div className="pb-cmen" role="listbox">{options.map((n) => <button key={n} type="button" role="option" onMouseDown={(e) => { e.preventDefault(); pick(n); }}>@{n}</button>)}</div>
      )}
      {soft && <span className="hintline">Enter sends, Shift Enter adds a line</span>}
      <div className="row">
        {onCancel && <button type="button" className="ghost" onClick={onCancel}>Cancel</button>}
        <button type="button" className="go" disabled={!ok || busy} onClick={send} data-testid="comment-send">{soft && <Send size={14} aria-hidden="true" />}{mode === 'suggest' ? 'Suggest' : reply && soft ? 'Send' : 'Comment'}</button>
      </div>
    </div>
  );
}

const Body = ({ text }) => text.split(/(@[^\s@]+(?: [^\s@]+)?)/g).map((p, i) => (p.startsWith('@') ? <b key={i} className="pb-cmention">{p}</b> : <span key={i}>{p}</span>));

export default function CommentsDock({ rt, editor, rootRef, target, ready, dark, children }) {
  const [comments, setComments] = useState([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(null); // { quote, mode }
  const [tab, setTab] = useState('open');
  const [replyTo, setReplyTo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [focusId, setFocusId] = useState(null);
  const [fresh, setFresh] = useState(false);
  const ref = useRef([]);
  ref.current = comments;
  const known = useRef(null);
  const peers = usePeers(rt);
  const me = rt?.user;
  const soft = target?.kind === 'guest'; // people on a share link get the Soft Studio panel (S22, S23)
  const tkey = target ? `${target.kind}:${target.noteId || target.share}:${target.sid || ''}` : '';

  const load = useCallback(async () => {
    if (!target) return;
    try { setComments(await commentsApi.list(target)); } catch { /* the next refresh tries again */ }
  }, [tkey]); // eslint-disable-line react-hooks/exhaustive-deps

  const ping = () => { try { rt?.doc.transact(() => rt.doc.getMap('pings').set('comments', Date.now()), 'pb-editors'); } catch { /* not live */ } };

  useEffect(() => {
    if (!target) return undefined;
    void load();
    const t = setInterval(load, rt ? 30000 : 10000);
    const pings = rt?.doc.getMap('pings');
    const on = () => { void load(); };
    pings?.observe(on);
    return () => { clearInterval(t); pings?.unobserve(on); };
  }, [tkey, rt, load]); // eslint-disable-line react-hooks/exhaustive-deps

  // new comments from other people: pulse the button, and say so when someone mentions me
  useEffect(() => {
    const ids = new Set(comments.map((c) => c.id));
    if (known.current === null) { known.current = ids; return; }
    const added = comments.filter((c) => !known.current.has(c.id) && !c.author.self);
    known.current = ids;
    if (!added.length) return;
    if (!open) setFresh(true);
    const mine = added.find((c) => me && c.mentions.includes(me.name));
    if (mine) window.dispatchEvent(new CustomEvent('pb-upload', { detail: { state: 'done', message: `${mine.author.name} mentioned you in a comment` } }));
  }, [comments]); // eslint-disable-line react-hooks/exhaustive-deps

  // marks on the commented words
  useEffect(() => {
    if (!editor || !target || (rt && !ready)) return undefined;
    const key = new PluginKey('pb-comments-marks');
    const plugin = new Plugin({
      key,
      props: {
        decorations(state) {
          const out = [];
          const perBlock = new Map(); // block position -> { n threads, replies, first thread id, suggestion? }
          for (const c of ref.current) {
            if (c.parentId || c.status !== 'open' || !c.quote) continue;
            const hit = findQuote(state.doc, c.quote);
            if (!hit) continue;
            out.push(Decoration.inline(hit.from, hit.to, { class: `pb-commented${c.kind === 'suggestion' ? ' sug' : ''}`, 'data-cid': c.id }));
            // the block the words sit in, for the count badge in the margin
            const $p = state.doc.resolve(hit.from);
            for (let d = $p.depth; d > 0; d -= 1) {
              if ($p.node(d).type.name === 'blockContainer') {
                const start = $p.before(d);
                const node = $p.node(d);
                const e = perBlock.get(start) || { node, n: 0, replies: 0, id: c.id, sug: false };
                e.n += 1; e.sug = e.sug || c.kind === 'suggestion';
                e.replies += ref.current.filter((r) => r.parentId === c.id).length;
                perBlock.set(start, e);
                break;
              }
            }
          }
          perBlock.forEach((e, start) => {
            if (!e.node.firstChild) return;
            const total = e.n + e.replies;
            out.push(Decoration.widget(start + 1 + e.node.firstChild.nodeSize, () => {
              const b = document.createElement('button');
              b.type = 'button';
              b.className = 'pb-mbadge' + (e.sug ? ' sug' : '');
              b.contentEditable = 'false';
              b.setAttribute('data-testid', 'margin-badge');
              b.title = `${e.n} ${e.n === 1 ? 'thread' : 'threads'} on this paragraph. Open`;
              b.setAttribute('aria-label', b.title);
              b.innerHTML = `${icSvg(e.sug ? 'suggest' : 'comment', 13)}<span>${total}</span>`;
              b.addEventListener('mousedown', (ev) => ev.preventDefault());
              b.addEventListener('click', (ev) => { ev.preventDefault(); window.dispatchEvent(new CustomEvent('pb-focus-thread', { detail: { id: e.id } })); });
              return b;
            }, { side: 1, key: `mb-${start}-${total}-${e.sug ? 's' : 'c'}-${e.id}`, stopEvent: () => true, ignoreSelection: true }));
          });
          return DecorationSet.create(state.doc, out);
        },
      },
    });
    try { editor.registerExtension({ key: 'pb-comments-marks', prosemirrorPlugins: [plugin] }); } catch { /* editor not ready */ }
    return () => { try { editor.unregisterExtension('pb-comments-marks'); } catch { /* editor already gone */ } };
  }, [editor, tkey, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { editor?.transact((tr) => tr.setMeta('pb-comments-refresh', Date.now())); } catch { /* editor not ready */ } }, [comments, editor]);

  // the toolbar's Comment / Suggest buttons, and a click on a marked word
  useEffect(() => {
    const start = (e) => { setDraft({ quote: e.detail?.quote || '', mode: e.detail?.mode === 'suggest' ? 'suggest' : 'comment' }); setOpen(true); setFresh(false); setErr(''); };
    window.addEventListener('pb-comment-start', start);
    const focus = (e) => { setFocusId(e.detail?.id || null); setTab('open'); setOpen(true); setFresh(false); };
    window.addEventListener('pb-focus-thread', focus);
    const root = rootRef?.current;
    const click = (e) => {
      const m = e.target?.closest?.('.pb-commented');
      if (!m) return;
      setFocusId(m.getAttribute('data-cid')); setTab('open'); setOpen(true); setFresh(false);
    };
    root?.addEventListener('click', click);
    return () => { window.removeEventListener('pb-comment-start', start); window.removeEventListener('pb-focus-thread', focus); root?.removeEventListener('click', click); };
  }, [rootRef]);
  useEffect(() => {
    if (!open || !focusId) return;
    const el = document.querySelector(`[data-thread="${focusId}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [open, focusId, comments]);

  const roots = useMemo(() => comments.filter((c) => !c.parentId), [comments]);
  const replies = useMemo(() => { const m = new Map(); for (const c of comments) if (c.parentId) m.set(c.parentId, [...(m.get(c.parentId) || []), c]); return m; }, [comments]);
  const openCount = roots.filter((c) => c.status === 'open').length;
  const people = useMemo(() => [...new Set([...peers.filter((p) => !p.me).map((p) => p.name), ...comments.map((c) => c.author.name)].filter((n) => n && n !== me?.name))], [peers, comments, me?.name]);
  const [order, setOrder] = useState('new'); // hooks must all run before the early return below
  if (!target) return <div className="pb-dock" style={{ '--pb-bg': dark ? '#1f2430' : '#ffffff' }}>{children}</div>;

  const run = async (fn) => { setBusy(true); setErr(''); try { await fn(); await load(); ping(); } catch (e) { setErr(e?.response?.data?.error || (e?.message === 'moved' ? 'moved' : 'That did not work. Try again.')); } setBusy(false); };
  const submit = (parentId) => (v) => run(async () => {
    await commentsApi.add(target, { kind: draft?.mode === 'suggest' && !parentId ? 'suggestion' : 'comment', body: v.body, quote: parentId ? undefined : draft?.quote, replacement: v.replacement, mentions: v.mentions, parentId, color: me?.color });
    if (parentId) setReplyTo(null); else setDraft(null);
  });
  const accept = (c) => run(async () => {
    const hit = findQuote(editor.prosemirrorState.doc, c.quote);
    if (!hit) throw new Error('moved');
    editor.transact((tr) => tr.insertText(c.replacement || '', hit.from, hit.to));
    await commentsApi.status(target, c.id, 'accepted');
  }).then(() => undefined);
  const setStatus = (c, status) => run(() => commentsApi.status(target, c.id, status));
  const remove = (c) => run(() => commentsApi.remove(target, c.id));
  const startFromSelection = (mode) => {
    let quote = '';
    try { quote = (editor.getSelectedText() || '').trim(); } catch { /* no selection */ }
    setDraft({ quote, mode }); setErr('');
  };

  const nOpen = roots.filter((c) => c.status === 'open').length;
  const nDone = roots.length - nOpen;
  const mineIds = new Set(comments.filter((c) => c.author.self).map((c) => c.parentId || c.id));
  const nMine = roots.filter((c) => mineIds.has(c.id)).length;
  const picked = roots.filter((c) => (tab === 'mine' ? mineIds.has(c.id) : tab === 'open' ? c.status === 'open' : c.status !== 'open')).slice();
  const shown = order === 'new' ? picked.reverse() : picked;
  const col = dark ? { bg: '#1f2430', fg: '#e7e9ee', line: '#333a49', soft: '#2a3040' } : { bg: '#ffffff', fg: '#1b1f2a', line: '#dfe3ea', soft: '#f3f5f9' };

  const renderCard = (c) => {
    const list = replies.get(c.id) || [];
    const done = c.status !== 'open';
    return (
      <li key={c.id} className={`pb-cthread${focusId === c.id ? ' on' : ''}${done ? ' done' : ''}`} data-thread={c.id} data-testid="comment-thread">
        {c.quote && <blockquote style={{ borderColor: c.author.color }}>{c.kind === 'suggestion' ? <del>{c.quote}</del> : c.quote}</blockquote>}
        {c.kind === 'suggestion' && <div className="pb-csug" data-testid="suggestion"><Ic name="arrowRight" size={13} style={{ marginRight: 4, verticalAlign: '-2px' }} /><ins>{c.replacement || '(delete)'}</ins>{c.status === 'accepted' && <em> accepted</em>}{c.status === 'rejected' && <em> rejected</em>}</div>}
        {[c, ...list].map((x) => (
          <div key={x.id} className="pb-citem">
            <div className="who"><i style={{ background: x.author.color }}>{(x.author.name[0] || '?').toUpperCase()}</i><b>{x.author.name}{x.author.self ? ' (you)' : ''}</b><span>{ago(x.createdAt)}</span>
              {(x.author.self || !target.sid) && <button type="button" className="x" aria-label="Delete this comment" onClick={() => remove(x)}><Ic name="x" size={15} /></button>}
            </div>
            {x.body && <p><Body text={x.body} /></p>}
          </div>
        ))}
        {!done && (
          replyTo === c.id
            ? <Composer mode="comment" people={people} busy={busy} autoFocus soft={soft} reply onCancel={() => setReplyTo(null)} onSubmit={submit(c.id)} />
            : (
              <div className="acts">
                <button type="button" onClick={() => setReplyTo(c.id)}>{soft && <MessageSquare size={13} aria-hidden="true" />}Reply</button>
                {c.kind === 'suggestion' ? (
                  <>
                    <button type="button" className="go" disabled={busy} onClick={() => accept(c)} data-testid="accept-suggestion">Accept</button>
                    <button type="button" disabled={busy} onClick={() => setStatus(c, 'rejected')}>Reject</button>
                  </>
                ) : <button type="button" disabled={busy} onClick={() => setStatus(c, 'resolved')} data-testid="resolve">{soft && <Check size={13} aria-hidden="true" />}Resolve</button>}
              </div>
            )
        )}
        {c.status === 'resolved' && <div className="acts"><span className="tag">Resolved</span><button type="button" onClick={() => setStatus(c, 'open')}>Reopen</button></div>}
      </li>
    );
  };

  return (
    <>
      <div className="pb-dock" style={{ '--pb-bg': dark ? '#1f2430' : '#ffffff' }}>
        <button type="button" className={`pb-cbtn${fresh ? ' fresh' : ''}${open ? ' on' : ''}`} onClick={() => { setOpen((o) => !o); setFresh(false); }} aria-label={`Comments, ${openCount} open`} aria-expanded={open} data-testid="comments-button" title="Comments and suggestions">
          <Ic name="comment" size={16} />{openCount > 0 && <b>{openCount}</b>}
        </button>
        {children}
      </div>
      {open && createPortal(
        <aside className={`pb-cpanel${soft ? ' soft' : ''}`} role="complementary" aria-label="Comments" data-testid="comments-panel" style={soft ? undefined : { background: col.bg, color: col.fg, borderColor: col.line }}>
          <header>
            <h3>Comments</h3>
            {!soft && (
              <div className="tabs" role="tablist">
                <button type="button" role="tab" aria-selected={tab === 'open'} onClick={() => setTab('open')}>Open{nOpen > 0 ? ` ${nOpen}` : ''}</button>
                <button type="button" role="tab" aria-selected={tab === 'done'} onClick={() => setTab('done')}>Done{nDone > 0 ? ` ${nDone}` : ''}</button>
              </div>
            )}
            <button type="button" className="x" aria-label="Close comments" onClick={() => setOpen(false)}>{soft ? <XIcon size={14} aria-hidden="true" /> : <Ic name="x" size={15} />}</button>
          </header>
          {soft && (
            <div className="tabs soft-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'open'} onClick={() => setTab('open')}>Open{nOpen > 0 ? ` ${nOpen}` : ''}</button>
              <button type="button" role="tab" aria-selected={tab === 'done'} onClick={() => setTab('done')}>Resolved{nDone > 0 ? ` ${nDone}` : ''}</button>
              <button type="button" role="tab" aria-selected={tab === 'mine'} onClick={() => setTab('mine')} data-testid="comments-tab-mine">Mine{nMine > 0 ? ` ${nMine}` : ''}</button>
            </div>
          )}
          <div className="scroll">
            {draft ? (
              <div className="pb-cnew" data-testid="comment-draft">
                {draft.quote ? <blockquote>{draft.quote}</blockquote> : <p className="hint">No words are selected. Select some words in the note, then press Comment, to attach this to them.</p>}
                <Composer mode={draft.mode} quote={draft.quote} people={people} busy={busy} autoFocus soft={soft} onCancel={() => setDraft(null)} onSubmit={submit(null)} />
              </div>
            ) : (
              <div className="pb-cstart">
                <button type="button" onClick={() => startFromSelection('comment')} data-testid="comment-on-selection">Comment on selection</button>
                <button type="button" onClick={() => startFromSelection('suggest')} data-testid="suggest-on-selection">Suggest an edit</button>
              </div>
            )}
            {err && <p role="alert" className="pb-cerr">{err === 'moved' ? 'Those words changed, so this suggestion cannot be applied any more.' : err}</p>}
            {shown.length > 1 && <div className="pb-csort"><button type="button" data-testid="comment-sort" onClick={() => setOrder((o) => (o === 'new' ? 'old' : 'new'))}>{order === 'new' ? 'Newest first' : 'Oldest first'}</button></div>}
            <ul>
              {shown.map((c) => renderCard(c))}
              {shown.length === 0 && <li className="hint">{tab === 'open' ? 'No open comments. Select some words and press Comment.' : tab === 'mine' ? 'You have not commented yet.' : 'Nothing finished yet.'}</li>}
            </ul>
          </div>
        </aside>,
        (soft && document.querySelector('.pb-shared')) || document.body, // inside the share page so the Soft Studio colours apply
      )}
      <style>{`
        .bn-editor .bn-block { position: relative; }
        .pb-mbadge { position: absolute; right: -46px; top: 3px; display: inline-flex; align-items: center; gap: 4px; border: 1px solid color-mix(in srgb, currentColor 18%, transparent); background: color-mix(in srgb, var(--pb-bg, #fff) 94%, transparent); color: #b45309; border-radius: 999px; padding: 2px 8px 2px 6px; font: 700 11.5px/1.4 'Figtree', system-ui, sans-serif; cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,.1); user-select: none; z-index: 2; }
        .pb-mbadge.sug { color: #2563eb; }
        .pb-mbadge:hover { background: color-mix(in srgb, currentColor 12%, var(--pb-bg, #fff)); }
        @media (max-width: 900px) { .pb-mbadge { right: -6px; top: -9px; } }
        .pb-dock { position: sticky; top: 6px; height: 0; z-index: 20; display: flex; justify-content: flex-end; align-items: flex-start; gap: 8px; pointer-events: none; }
        .pb-dock > * { pointer-events: auto; }
        .pb-cbtn { height: 34px; min-width: 34px; padding: 0 9px; border-radius: 999px; border: 1px solid color-mix(in srgb, currentColor 16%, transparent); background: color-mix(in srgb, var(--pb-bg, #fff) 92%, transparent); backdrop-filter: blur(6px); cursor: pointer; display: inline-flex; align-items: center; gap: 5px; font-size: 14px; color: inherit; box-shadow: 0 2px 10px rgba(0,0,0,.08); }
        .pb-cbtn b { font-size: 12px; background: #f59e0b; color: #fff; border-radius: 999px; padding: 1px 6px; }
        .pb-cbtn.on { outline: 2px solid #f59e0b; }
        .pb-cbtn.fresh { animation: pb-cfresh 1.2s ease-in-out infinite; }
        @keyframes pb-cfresh { 0%,100% { box-shadow: 0 0 0 0 rgba(245,158,11,.6); } 50% { box-shadow: 0 0 0 7px rgba(245,158,11,0); } }
        .pb-csort { display: flex; justify-content: flex-end; padding: 0 2px 6px; }
        .pb-csort button { border: 0; background: transparent; color: inherit; opacity: .7; font: inherit; font-size: 12px; cursor: pointer; text-decoration: underline; }
        .pb-commented { background: rgba(250, 204, 21, .32); border-bottom: 2px solid #f59e0b; border-radius: 2px; cursor: pointer; }
        .pb-commented.sug { background: rgba(59, 130, 246, .22); border-bottom-color: #3b82f6; }
        .pb-cpanel { position: fixed; z-index: 1200; top: 64px; right: 14px; bottom: 14px; width: min(360px, calc(100vw - 28px)); border: 1px solid; border-radius: 14px; box-shadow: 0 18px 50px rgba(0,0,0,.28); display: flex; flex-direction: column; font-size: 13.5px; }
        .pb-cpanel header { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid color-mix(in srgb, currentColor 14%, transparent); }
        .pb-cpanel h3 { margin: 0; font-size: 15px; flex: 1; }
        .pb-cpanel .tabs { display: flex; gap: 2px; background: color-mix(in srgb, currentColor 8%, transparent); border-radius: 8px; padding: 2px; }
        .pb-cpanel .tabs button { border: 0; background: transparent; color: inherit; padding: 4px 10px; border-radius: 6px; cursor: pointer; font: inherit; }
        .pb-cpanel .tabs button[aria-selected="true"] { background: color-mix(in srgb, currentColor 16%, transparent); font-weight: 700; }
        .pb-cpanel .x { border: 0; background: transparent; color: inherit; cursor: pointer; font-size: 18px; line-height: 1; opacity: .6; margin-left: auto; }
        .pb-cpanel .scroll { overflow-y: auto; padding: 10px 12px 14px; flex: 1; }
        .pb-cpanel ul { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 10px; }
        .pb-cpanel .hint { opacity: .65; font-size: 13px; margin: 6px 0; }
        .pb-cstart { display: flex; gap: 8px; flex-wrap: wrap; }
        .pb-cstart button, .pb-cthread .acts button, .pb-cform .ghost { border: 1px solid color-mix(in srgb, currentColor 22%, transparent); background: transparent; color: inherit; border-radius: 8px; padding: 5px 10px; cursor: pointer; font: inherit; }
        .pb-cthread .acts button.go, .pb-cform .go { background: #2563eb; border-color: #2563eb; color: #fff; font-weight: 700; border-radius: 8px; padding: 5px 12px; cursor: pointer; }
        .pb-cform .go:disabled, .pb-cthread .acts button:disabled { opacity: .5; cursor: default; }
        .pb-cthread { border: 1px solid color-mix(in srgb, currentColor 14%, transparent); border-radius: 10px; padding: 9px 10px; }
        .pb-cthread.on { outline: 2px solid #f59e0b; }
        .pb-cthread.done { opacity: .75; }
        .pb-cthread blockquote, .pb-cnew blockquote { margin: 0 0 8px; padding: 2px 8px; border-left: 3px solid #f59e0b; opacity: .85; font-style: italic; overflow-wrap: anywhere; max-height: 5.5em; overflow: hidden; }
        .pb-csug { margin: 0 0 6px; } .pb-csug ins { background: rgba(34,197,94,.25); text-decoration: none; padding: 0 2px; border-radius: 3px; } .pb-csug em { opacity: .7; margin-left: 6px; }
        .pb-citem .who { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
        .pb-citem .who i { width: 20px; height: 20px; border-radius: 50%; color: #fff; font-size: 11px; font-style: normal; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; }
        .pb-citem .who span { opacity: .6; font-size: 12px; }
        .pb-citem p { margin: 3px 0 0 26px; white-space: pre-wrap; overflow-wrap: anywhere; }
        .pb-cmention { color: #2563eb; font-weight: 700; }
        .pb-cthread .acts { display: flex; gap: 6px; margin-top: 8px; align-items: center; }
        .pb-cthread .tag { font-size: 12px; opacity: .7; }
        .pb-cform { display: grid; gap: 6px; margin-top: 6px; position: relative; }
        .pb-cform textarea { width: 100%; box-sizing: border-box; resize: vertical; padding: 7px 9px; border-radius: 8px; border: 1px solid color-mix(in srgb, currentColor 22%, transparent); background: transparent; color: inherit; font: inherit; }
        .pb-cform .lbl { font-size: 12px; opacity: .7; }
        .pb-cform .row { display: flex; justify-content: flex-end; gap: 6px; }
        .pb-cmen { display: flex; gap: 4px; flex-wrap: wrap; } .pb-cmen button { border: 1px solid #2563eb55; background: #2563eb18; color: inherit; border-radius: 999px; padding: 2px 9px; cursor: pointer; font: inherit; }
        .pb-cerr { color: #dc2626; margin: 8px 0 0; }
        @media (max-width: 640px) { .pb-cpanel { top: auto; height: 62vh; left: 8px; right: 8px; width: auto; } }
        /* Soft Studio comments panel on share pages (S22, S23) */
        .pb-cpanel.soft { top: 96px; right: 48px; bottom: auto; height: calc(100vh - 120px); max-height: calc(100dvh - 120px); width: min(284px, calc(100vw - 28px)); border: 0; border-radius: 30px; padding: 16px; gap: 10px; background: var(--surface, #fff); color: var(--fg, #241F1A); box-shadow: 0 30px 70px rgba(60,40,20,.28), inset 0 0 0 1px var(--line, #EADFD0); overflow: hidden; box-sizing: border-box; font-family: 'Figtree', system-ui, sans-serif; }
        .pb-cpanel.soft header { padding: 0; border: 0; }
        .pb-cpanel.soft h3 { font: 800 21px 'Bricolage Grotesque', system-ui, sans-serif; letter-spacing: -.01em; }
        .pb-cpanel.soft .x { width: 30px; height: 30px; margin: 0; border-radius: 50%; display: grid; place-items: center; background: var(--chip, #F4EEE5); opacity: 1; flex: none; }
        .pb-cpanel.soft .soft-tabs { display: flex; gap: 0; padding: 3px; border-radius: 999px; background: var(--chip, #F4EEE5); }
        .pb-cpanel.soft .soft-tabs button { flex: 1; height: 34px; padding: 0; border-radius: 999px; font-weight: 800; font-size: 13px; color: var(--fg2, #564D43); }
        .pb-cpanel.soft .soft-tabs button[aria-selected="true"] { background: var(--surface, #fff); color: var(--fg, #241F1A); box-shadow: 0 1px 3px rgba(0,0,0,.12); }
        .pb-cpanel.soft .scroll { padding: 0; margin: 0 -4px; padding: 0 4px; }
        .pb-cpanel.soft ul { margin: 8px 0 0; gap: 10px; }
        .pb-cpanel.soft .pb-cthread { border: 0; border-radius: 22px; padding: 12px 14px; background: var(--chip, #F4EEE5); display: flex; flex-direction: column; gap: 6px; }
        .pb-cpanel.soft .pb-cthread.on { outline: 0; background: var(--butter, #FFF3CC); box-shadow: inset 0 0 0 2px #E8B84A; }
        .pb-cpanel.soft .pb-cthread.done { opacity: .8; }
        .pb-cpanel.soft .pb-cthread blockquote { margin: 0; padding: 0 0 0 8px; border: 0; border-left: 3px solid var(--butter, #FFE9A6) !important; font: 600 12px/1.4 'Figtree', system-ui, sans-serif; font-style: normal; color: var(--fg2, #564D43); opacity: 1; }
        .pb-cpanel.soft .pb-citem .who { margin-top: 0; gap: 8px; }
        .pb-cpanel.soft .pb-citem .who i { width: 26px; height: 26px; font-size: 12px; font-weight: 800; color: var(--fg, #241F1A); box-shadow: 0 0 0 2px var(--surface, #fff); }
        .pb-cpanel.soft .pb-citem .who b { font-size: 13.5px; }
        .pb-cpanel.soft .pb-citem .who span { font-size: 12.5px; font-weight: 600; opacity: 1; color: var(--fg2, #564D43); }
        .pb-cpanel.soft .pb-citem p { margin: 4px 0 0; font-size: 13.5px; line-height: 1.4; }
        .pb-cpanel.soft .pb-citem + .pb-citem { margin-top: 2px; padding: 8px 10px; border-radius: 16px; background: var(--surface, #fff); }
        .pb-cpanel.soft .pb-citem + .pb-citem p { margin-left: 0; font-size: 13px; }
        .pb-cpanel.soft .pb-citem + .pb-citem .who i { width: 24px; height: 24px; font-size: 11px; }
        .pb-cpanel.soft .pb-cthread .acts { gap: 6px; margin: 2px 0 0; }
        .pb-cpanel.soft .pb-cstart button, .pb-cpanel.soft .pb-cthread .acts button, .pb-cpanel.soft .pb-cform .ghost { height: 28px; padding: 0 10px; border: 0; border-radius: 999px; background: var(--surface, #fff); color: var(--fg, #241F1A); box-shadow: inset 0 0 0 1px var(--line, #EADFD0); font-size: 12px; font-weight: 800; display: inline-flex; align-items: center; gap: 6px; }
        .pb-cpanel.soft .pb-cthread .acts button.go { background: var(--accent, #C4441C); color: var(--on-accent, #fff); box-shadow: none; }
        .pb-cpanel.soft .pb-cform { margin-top: 2px; }
        .pb-cpanel.soft .pb-cform textarea { min-height: 64px; padding: 10px 14px; border: 0; border-radius: 20px; background: var(--bg, #FBF6EE); box-shadow: inset 0 0 0 2px var(--accent, #C4441C); font-size: 13px; font-weight: 600; outline: 0; resize: none; }
        .pb-cpanel.soft .pb-cform .hintline { font-size: 12.5px; font-weight: 600; color: var(--fg2, #564D43); }
        .pb-cpanel.soft .pb-cform .row { align-items: center; }
        .pb-cpanel.soft .pb-cform .go { height: 36px; padding: 0 16px; border: 0; border-radius: 999px; background: var(--accent, #C4441C); color: var(--on-accent, #fff); font-size: 14px; font-weight: 800; display: inline-flex; align-items: center; gap: 8px; }
        .pb-cpanel.soft .pb-cmen { flex-direction: column; gap: 2px; padding: 6px; border-radius: 18px; background: var(--surface, #fff); box-shadow: 0 10px 30px rgba(60,40,20,.2), inset 0 0 0 1px var(--line, #EADFD0); }
        .pb-cpanel.soft .pb-cmen button { border: 0; border-radius: 12px; background: transparent; padding: 8px 10px; text-align: left; font-weight: 700; font-size: 13px; }
        .pb-cpanel.soft .pb-cmen button:hover, .pb-cpanel.soft .pb-cmen button:focus-visible { background: var(--chip, #F4EEE5); }
        .pb-cpanel.soft .pb-cmention { color: var(--accent-ink, #A8380F); }
        .pb-cpanel.soft .pb-cnew { padding: 12px 14px; border-radius: 22px; background: var(--chip, #F4EEE5); }
        .pb-cpanel.soft .pb-cnew blockquote { border-left: 3px solid var(--butter, #FFE9A6); font-style: normal; font-size: 12px; font-weight: 600; opacity: 1; }
        @media (max-width: 1100px) { .pb-cpanel.soft { right: 14px; } }
        @media (max-width: 640px) { .pb-cpanel.soft { top: auto; height: 62vh; left: 8px; right: 8px; width: auto; border-radius: 26px; } }
        @media (prefers-reduced-motion: reduce) { .pb-cbtn.fresh { animation: none; } }
      `}</style>
    </>
  );
}
