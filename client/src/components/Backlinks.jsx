import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Link2 } from 'lucide-react';
import { notesAPI } from '../api';

// PEB-273: "Linked from" under a note: the other notes that link to it with @.
export default function Backlinks({ noteId }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let alive = true;
    setRows([]);
    if (!noteId) return undefined;
    notesAPI.backlinks(noteId).then((r) => { if (alive) setRows(r.data.backlinks || []); }).catch(() => {});
    return () => { alive = false; };
  }, [noteId]);
  if (!rows.length) return null;
  return (
    <section className="peblo-backlinks" aria-label="Linked from" style={{ margin: '2rem 0 1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border, rgba(128,128,128,.25))', fontSize: '0.9rem' }}>
      <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', margin: '0 0 0.4rem', fontSize: '0.85rem', opacity: 0.75 }}>
        <Link2 size={14} /> Linked from {rows.length} {rows.length === 1 ? 'note' : 'notes'}
      </h4>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((n) => (
          <li key={n.id} style={{ padding: '0.15rem 0' }}>
            <Link to={`/notes/${n.id}`} style={{ color: 'var(--accent, #6366f1)' }}>{n.title || 'Untitled'}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
