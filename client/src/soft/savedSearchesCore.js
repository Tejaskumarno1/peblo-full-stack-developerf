// Saved searches (N46): at most 8, kept in the account (settings.savedSearches) so every device has them. The old
// per-device list in localStorage is the fallback and is moved to the account once.
export const SAVED_KEY = 'peblo-saved-searches';
export const SAVED_MAX = 8;
export const cleanSaved = (a) => (Array.isArray(a) ? [...new Set(a.filter((x) => typeof x === 'string').map((x) => x.trim().slice(0, 80)).filter(Boolean))].slice(0, SAVED_MAX) : []);
export const addSaved = (list, q) => { const t = String(q || '').trim().slice(0, 80); return !t || list.includes(t) ? list : [t, ...list].slice(0, SAVED_MAX); };
export const dropSaved = (list, q) => list.filter((x) => x !== q);
/** Which list to show: the account's when it has one; otherwise this device's, which is then copied up (`migrate`). */
export function resolveSaved(account, local) {
  if (Array.isArray(account)) return { list: cleanSaved(account), migrate: false };
  const l = cleanSaved(local);
  return { list: l, migrate: l.length > 0 };
}
