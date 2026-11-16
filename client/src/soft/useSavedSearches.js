import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { SAVED_KEY, addSaved, cleanSaved, dropSaved, resolveSaved } from './savedSearchesCore';

const readLocal = () => { try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'); } catch { return []; } };

/** Saved searches of the Notes list, synced to the account (settings.savedSearches). */
export function useSavedSearches() {
  const { settings, updateSettings } = useAuth();
  const [local, setLocal] = useState(readLocal);
  const { list, migrate } = resolveSaved(settings?.savedSearches, local);
  useEffect(() => { if (migrate) updateSettings({ savedSearches: list }); }, [migrate]); // eslint-disable-line react-hooks/exhaustive-deps
  const write = (next) => {
    const n = cleanSaved(next);
    setLocal(n);
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(n)); } catch { /* ignore */ }
    updateSettings({ savedSearches: n });
  };
  return { list, add: (q) => { const n = addSaved(list, q); if (n !== list) write(n); }, drop: (q) => write(dropSaved(list, q)) };
}
