import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Link2 } from 'lucide-react';
import { notesAPI } from '../api';

// Under a note: the notes that link to it, and (optionally) notes that say its title without linking to it yet.
export default function Backlinks({ noteId, mentions = true }) {
  const [rows, setRows] = useState([]);
  const [said, setSaid] = useState([]);
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    if (!noteId) return () => {};
    let alive = true;
    notesAPI.backlinks(noteId).then((r) => { if (alive) setRows(r.data.backlinks || []); }).catch(() => {});
    if (mentions) notesAPI.mentions(noteId).then((r) => { if (alive) setSaid(r.data.mentions || []); }).catch(() => {});
    return () => { alive = false; };
  }, [noteId, mentions]);

  useEffect(() => {
    setRows([]); setSaid([]);
    return load();
  }, [load]);

  const link = async (id) => {
    setBusy(id);
    try { await notesAPI.linkMention(noteId, id); } catch { /* the list refreshes either way */ }
    setBusy('');
    load();
  };

  if (!rows.length && !said.length) return null;
  const box = { margin: '2rem 0 1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border, rgba(128,128,128,.25))', fontSize: '0.9rem' };
  const head = { display: 'flex', alignItems: 'center', gap: '0.4rem', margin: '0 0 0.4rem', fontSize: '0.85rem', opacity: 0.75 };
  return (
    <div className="peblo-links-wrap">
      {rows.length > 0 && (
        <section className="peblo-backlinks" aria-label="Linked from" style={box}>
          <h4 style={head}><Link2 size={14} /> Linked from {rows.length} {rows.length === 1 ? 'note' : 'notes'}</h4>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {rows.map((n) => (
              <li key={n.id} style={{ padding: '0.15rem 0' }}>
                <Link to={`/notes/${n.id}`} style={{ color: 'var(--accent, #6366f1)' }}>{n.title || 'Untitled'}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {said.length > 0 && (
        <section className="peblo-mentions" aria-label="Mentioned without a link" style={{ ...box, marginTop: rows.length ? '0.5rem' : box.margin.split(' ')[0] }}>
          <h4 style={head}>Mentioned in {said.length} {said.length === 1 ? 'note' : 'notes'} without a link</h4>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {said.map((n) => (
              <li key={n.id} style={{ padding: '0.3rem 0', display: 'flex', gap: '0.6rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
                <Link to={`/notes/${n.id}`} style={{ color: 'var(--accent, #6366f1)', fontWeight: 600 }}>{n.title || 'Untitled'}</Link>
                <span style={{ opacity: 0.6, flex: 1, minWidth: 160 }}>{n.snippet}</span>
                <button type="button" className="peblo-link-it" disabled={busy === n.id} onClick={() => link(n.id)} style={{ border: '1px solid currentColor', background: 'transparent', color: 'inherit', borderRadius: 999, padding: '2px 10px', cursor: 'pointer', font: 'inherit', fontSize: '0.8rem' }}>
                  {busy === n.id ? 'Linking…' : 'Link it'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
