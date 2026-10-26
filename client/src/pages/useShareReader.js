import { useCallback, useEffect, useRef, useState } from 'react';

/*
 * What a reader keeps for themselves on a share link, all in this browser:
 *  - bookmarks on lines of the page,
 *  - where they stopped last time ("jump back"),
 *  - which lines changed since their last visit.
 * Lines are matched by their words, so it works for the live editor and for the read-only page alike.
 */

const blocksOf = (art) => {
  if (!art) return [];
  const live = [...art.querySelectorAll('.bn-editor .bn-block-outer')];
  return live.length ? live : [...art.querySelectorAll('.doc > *')];
};
const textOf = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
const sigOf = (el) => textOf(el).slice(0, 80).toLowerCase();
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h); };
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not kept */ } };

export default function useShareReader({ enabled, scope, articleRef, deps }) {
  const bmKey = `peblo-share-bm:${scope}`;
  const placeKey = `peblo-share-place:${scope}`;
  const seenKey = `peblo-share-seen:${scope}`;
  const [bookmarks, setBookmarks] = useState(() => load(bmKey, []));
  const [place, setPlace] = useState(null); // where I stopped last time
  const [changes, setChanges] = useState(null); // { count, at }
  const [showChanges, setShowChanges] = useState(true);
  const hover = useRef(null);
  const baseline = useRef(null); // hashes of the lines as I last saw them
  const decided = useRef(false);

  const scrollerTopBlock = useCallback(() => {
    const art = articleRef.current; if (!art) return null;
    const top = art.getBoundingClientRect().top + 24;
    return blocksOf(art).find((b) => b.getBoundingClientRect().bottom > top && textOf(b)) || null;
  }, [articleRef]);

  const go = useCallback((sig) => {
    const art = articleRef.current; if (!art) return;
    const el = blocksOf(art).find((b) => sigOf(b) === sig);
    if (!el) return;
    const top = art.scrollTop + el.getBoundingClientRect().top - art.getBoundingClientRect().top - 24;
    art.scrollTo({ top, behavior: 'smooth' });
  }, [articleRef]);

  const toggleBookmark = useCallback((el) => {
    const target = el || hover.current || scrollerTopBlock();
    if (!target) return false;
    const sig = sigOf(target); if (!sig) return false;
    setBookmarks((list) => {
      const next = list.some((b) => b.sig === sig) ? list.filter((b) => b.sig !== sig) : [...list, { sig, title: textOf(target).slice(0, 48), at: Date.now() }];
      save(bmKey, next);
      return next;
    });
    return true;
  }, [bmKey, scrollerTopBlock]);

  // which line the pointer is over, so B bookmarks it
  useEffect(() => {
    if (!enabled) return undefined;
    const over = (e) => { const art = articleRef.current; const b = e.target?.closest?.('.bn-block-outer, .doc > *'); hover.current = b && art?.contains(b) ? b : null; };
    document.addEventListener('mouseover', over);
    return () => document.removeEventListener('mouseover', over);
  }, [enabled, articleRef]);

  // B bookmarks the line under the pointer (not while typing)
  useEffect(() => {
    if (!enabled) return undefined;
    const key = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.key !== 'b' && e.key !== 'B')) return;
      if (e.target?.closest?.('input, textarea, select, [contenteditable="true"], .bn-editor')) return;
      if (document.documentElement.classList.contains('pb-presenting')) return;
      e.preventDefault(); toggleBookmark();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [enabled, toggleBookmark]);

  // remember where I am; on the next visit offer the way back
  useEffect(() => {
    if (!enabled) return undefined;
    const art = articleRef.current; if (!art) return undefined;
    const prev = load(placeKey, null);
    if (prev?.sig && !decided.current) setPlace(prev);
    let t;
    const onScroll = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const b = scrollerTopBlock(); if (!b || art.scrollTop < 200) return;
        save(placeKey, { sig: sigOf(b), title: textOf(b).slice(0, 48), at: Date.now() });
        setPlace((p) => (p && p.shown ? p : null)); // reading on dismisses the offer
      }, 600);
    };
    art.addEventListener('scroll', onScroll, { passive: true });
    return () => { clearTimeout(t); art.removeEventListener('scroll', onScroll); };
  }, [enabled, articleRef, placeKey, scrollerTopBlock, deps]);

  // lines that changed since the last visit: compared once, when the page first shows its text
  useEffect(() => {
    if (!enabled || decided.current) return undefined;
    let tries = 0;
    const iv = setInterval(() => {
      const art = articleRef.current; const blocks = blocksOf(art).filter((b) => textOf(b));
      tries += 1;
      if (blocks.length < 2 && tries < 25) return;
      clearInterval(iv);
      if (decided.current) return;
      decided.current = true;
      const old = load(seenKey, null);
      const now = blocks.map((b) => hash(textOf(b)));
      baseline.current = old?.hashes ? new Set(old.hashes) : null;
      if (old?.hashes) {
        const oldSet = new Set(old.hashes);
        const count = now.filter((h) => !oldSet.has(h)).length;
        if (count > 0) setChanges({ count, at: old.at });
      }
      // the snapshot a reader compares against next time: what they were shown now, refreshed when they leave
      const snap = () => { const a = articleRef.current; if (!a) return; const hs = blocksOf(a).filter((b) => textOf(b)).map((b) => hash(textOf(b))); if (hs.length) save(seenKey, { at: Date.now(), hashes: hs }); };
      snap();
      window.addEventListener('pagehide', snap);
      window.addEventListener('beforeunload', snap);
    }, 400);
    return () => clearInterval(iv);
  }, [enabled, articleRef, seenKey, deps]);

  // mark the lines (the editor redraws its blocks, so this repeats)
  useEffect(() => {
    if (!enabled) return undefined;
    const mark = () => {
      const art = articleRef.current; if (!art) return;
      const sigs = new Set(bookmarks.map((b) => b.sig));
      blocksOf(art).forEach((b) => {
        const t = textOf(b);
        if (t && sigs.has(sigOf(b))) b.setAttribute('data-pb-bm', '1'); else b.removeAttribute('data-pb-bm');
        if (t && baseline.current && changes && !baseline.current.has(hash(t))) b.setAttribute('data-pb-chg', '1'); else b.removeAttribute('data-pb-chg');
      });
    };
    mark();
    const iv = setInterval(mark, 800);
    return () => clearInterval(iv);
  }, [enabled, articleRef, bookmarks, changes, deps]);

  const removeBookmark = useCallback((sig) => { setBookmarks((list) => { const next = list.filter((b) => b.sig !== sig); save(bmKey, next); return next; }); }, [bmKey]);

  return {
    bookmarks, toggleBookmark, removeBookmark, goBookmark: go, place, dismissPlace: () => setPlace(null), jumpPlace: () => { if (place) go(place.sig); setPlace(null); },
    changes, showChanges, setShowChanges, dismissChanges: () => setChanges(null),
  };
}
