import { useState } from 'react';
import { Link2, Globe, Lock, Copy, Check, X } from 'lucide-react';
import '../styles/share-modal.css';

export default function ShareModal({ isOpen, onClose, note, onToggleShare }) {
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!isOpen || !note) return null;

  const url = note.isPublic && note.shareId ? `${window.location.origin}/shared/${note.shareId}` : '';

  const handleCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy', e);
    }
  };

  const handleToggle = async () => {
    setLoading(true);
    await onToggleShare();
    setLoading(false);
  };

  return (
    <div className="share-modal-overlay" onClick={onClose}>
      <div className="share-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="share-modal-header">
          <h3>Share "{note.title || 'Untitled'}"</h3>
          <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="share-modal-body">
          <div className="share-access-section">
            <h4>General access</h4>
            
            <div className="access-options">
              <button 
                type="button" 
                className={`access-option ${!note.isPublic ? 'active' : ''}`}
                onClick={note.isPublic ? handleToggle : undefined}
                disabled={loading}
              >
                <div className="access-icon restricted"><Lock size={16} /></div>
                <div className="access-info">
                  <span className="access-title">Restricted</span>
                  <span className="access-desc">Only you can view and edit this note</span>
                </div>
                {!note.isPublic && <Check size={16} className="access-check" />}
              </button>

              <button 
                type="button" 
                className={`access-option ${note.isPublic ? 'active' : ''}`}
                onClick={!note.isPublic ? handleToggle : undefined}
                disabled={loading}
              >
                <div className="access-icon public"><Globe size={16} /></div>
                <div className="access-info">
                  <span className="access-title">Anyone with the link</span>
                  <span className="access-desc">Anyone on the internet with the link can view</span>
                </div>
                {note.isPublic && <Check size={16} className="access-check" />}
              </button>
            </div>
          </div>

          {note.isPublic && (
            <div className="share-link-section">
              <div className="link-input-wrapper">
                <Link2 size={16} className="link-icon" />
                <input type="text" value={url} readOnly />
                <button 
                  type="button" 
                  className={`copy-btn ${copied ? 'copied' : ''}`}
                  onClick={handleCopy}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? 'Copied' : 'Copy link'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="share-modal-footer">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
