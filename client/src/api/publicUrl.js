import { useEffect, useState } from 'react';
import api from './client';

// The address other people (and other apps) should use: share links and the MCP address.
// It comes from the server so every install, including the desktop app, points at the hosted web address.
let pending = null;
export function loadPublicUrl() {
  if (!pending) {
    pending = api.get('/config').then((r) => String(r.data?.publicUrl || '').replace(/\/+$/, '')).catch(() => { pending = null; return ''; });
  }
  return pending;
}

/** The public address, or this page's own address until the server has answered. */
export function usePublicUrl() {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let live = true;
    loadPublicUrl().then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, []);
  return url;
}
