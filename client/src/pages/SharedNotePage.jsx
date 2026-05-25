import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { sharedAPI } from '../api/index';
import { marked } from 'marked';
import { Lock, Link2 } from 'lucide-react';
import { stringToColorClass } from '../utils/helpers';
import '../styles/shared.css';

export default function SharedNotePage() {
  const { shareId } = useParams();
  const [note, setNote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    sharedAPI.getNote(shareId)
      .then(res => setNote(res.data.note))
      .catch(err => setError(err.response?.data?.error || 'Note not found'))
      .finally(() => setLoading(false));
  }, [shareId]);

  if (loading) {
    return (
      <div className="shared-page">
        <div className="page-loader"><div className="spinner" /></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="shared-page">
        <div className="shared-error">
          <span className="error-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Lock size={48} color="var(--accent-coral)" />
          </span>
          <h1>Note Not Found</h1>
          <p>{error}</p>
          <Link to="/login" className="btn btn-primary">Go to Peblo Notes</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="shared-page">
      <header className="shared-header">
        <div className="auth-logo">
          <span className="logo-icon">P</span>
          <span className="logo-text">Peblo Notes</span>
        </div>
        <span className="shared-badge-header" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Link2 size={16} /> Shared Note
        </span>
      </header>

      <article className="shared-content">
        <div className="shared-meta">
          <h1>{note.title}</h1>
          <div className="shared-info">
            <span>By {note.author}</span>
            <span>•</span>
            <span>{new Date(note.updatedAt).toLocaleDateString('en', {
              year: 'numeric', month: 'long', day: 'numeric'
            })}</span>
          </div>
          {note.tags?.length > 0 && (
            <div className="shared-tags">
              {note.tags.map(t => <span key={t} className={`tag-chip ${stringToColorClass(t)}`}>{t}</span>)}
            </div>
          )}
        </div>

        <div
          className="shared-body markdown-preview"
          dangerouslySetInnerHTML={{ __html: marked.parse(note.content || '') }}
        />
      </article>

      <footer className="shared-footer">
        <p>Shared via <Link to="/">Peblo Notes</Link> — AI-Powered Workspace</p>
      </footer>
    </div>
  );
}
