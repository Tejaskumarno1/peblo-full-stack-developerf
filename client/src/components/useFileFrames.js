import { createElement, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { isFileUrl, unpackProps } from '../utils/docFiles';

function teardown(st) {
  const made = st.made; st.made = []; st.el = null; st.key = null; st.token += 1;
  if (!made.length) return;
  setTimeout(() => made.forEach(({ r, holder, host }) => { try { r.unmount(); } catch { /* gone */ } if (holder.isConnected) holder.replaceWith(host); }), 0);
}

/** Read-only pages draw a note from Markdown as plain HTML; the files in it ("![name](/api/files/..)") become the same frames the editor shows. */
export default function useFileFrames(ref, html) {
  const st = useRef({ made: [], el: null, key: null, token: 0 });
  useEffect(() => { // after every render: cheap when this content is already done
    const root = ref?.current; const s = st.current;
    if (!root) return;
    // a picture of a file still in the HTML means the page has not been turned into frames yet (or the HTML was written again)
    const imgs = [...root.querySelectorAll('img')].filter((i) => isFileUrl(i.getAttribute('src')));
    if (!imgs.length) { if (s.el !== root || s.key !== html) teardown(s); return; }
    teardown(s);
    s.el = root; s.key = html;
    const mine = s.token;
    import('./DocFile').then(({ DocFrame }) => {
      if (st.current.token !== mine) return;
      imgs.forEach((img) => {
        if (!img.isConnected) return;
        const p = img.parentElement;
        const host = p && p.tagName === 'P' && p.children.length === 1 && !p.textContent.trim() ? p : img;
        const holder = document.createElement('div');
        host.replaceWith(holder);
        const r = createRoot(holder);
        st.current.made.push({ r, holder, host });
        r.render(createElement(DocFrame, { p: unpackProps(img.getAttribute('src')), editable: false, title: document.title }));
      });
    });
  });
  useEffect(() => () => teardown(st.current), []);
}
