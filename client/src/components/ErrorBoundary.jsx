import { Component } from 'react';

/** A file of the app that could not be loaded (usually because a new version was published while this tab was open). */
export const isChunkError = (value) => /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError|Loading chunk .* failed/i.test(String(value?.message || value || ''));

/**
 * Reload once for a stale or missing file. A second failure within 30 s is not retried (no reload loop):
 * the person then sees the screen below instead of a blank page.
 */
export function reloadOnce() {
  try {
    const last = Number(sessionStorage.getItem('peblo-chunk-reload') || 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem('peblo-chunk-reload', String(Date.now()));
  } catch { /* storage blocked: reload anyway, once per page load is the best we can do */ }
  window.location.reload();
  return true;
}

if (typeof window !== 'undefined') {
  // Vite raises this when a lazily loaded file (or its CSS) cannot be fetched.
  window.addEventListener('vite:preloadError', (event) => { if (reloadOnce()) event.preventDefault(); });
  window.addEventListener('unhandledrejection', (event) => { if (isChunkError(event.reason)) reloadOnce(); });
}

/** Instead of a blank white page when something in the screen fails, show what happened and a way out. */
export default class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error('Peblo screen failed:', error, info?.componentStack);
    if (isChunkError(error)) reloadOnce();
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isChunkError(error);
    return (
      <div role="alert" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, boxSizing: 'border-box', background: 'var(--pb-bg, #FBF6EE)', color: 'var(--pb-fg, #241F1A)', font: '15px/1.5 system-ui, sans-serif' }}>
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ margin: '0 0 8px', fontSize: 22 }}>{stale ? 'Peblo was updated' : 'Something went wrong'}</h1>
          <p style={{ margin: '0 0 20px', opacity: 0.75 }}>{stale ? 'A newer version is available. Reload to continue.' : 'Your notes are safe. Reload the page to continue.'}</p>
          <button type="button" onClick={() => window.location.reload()} style={{ padding: '10px 22px', border: 0, borderRadius: 999, background: '#C4441C', color: '#fff', font: '600 15px system-ui, sans-serif', cursor: 'pointer' }}>Reload</button>
          <details style={{ marginTop: 18, opacity: 0.6, fontSize: 12, textAlign: 'left' }}>
            <summary style={{ cursor: 'pointer', textAlign: 'center' }}>Details</summary>
            <pre style={{ whiteSpace: 'pre-wrap' }}>{String(error?.message || error)}</pre>
          </details>
        </div>
      </div>
    );
  }
}
