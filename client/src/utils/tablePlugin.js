import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// ---- what the editor draws from those settings: data attributes on the table block and a height on its rows
export function makeTablePlugin(store) {
  let view = null; let ver = 0; let lastDoc = null; let lastVer = -1; let lastSet = null;
  store.subscribe(() => { ver++; Promise.resolve().then(() => { try { view?.dispatch(view.state.tr.setMeta('pbTables', ver)); } catch { /* the editor is gone */ } }); });
  return new Plugin({
    key: new PluginKey('pb-tables'),
    view(v) { view = v; return { destroy() { view = null; } }; },
    props: {
      decorations(state) {
        if (state.doc === lastDoc && ver === lastVer && lastSet) return lastSet;
        const out = [];
        state.doc.descendants((node, pos) => {
          if (node.type.name !== 'table') return true;
          const meta = store.get(state.doc.resolve(pos).parent.attrs?.id) || {};
          const a = {};
          if (meta.z) a['data-pb-z'] = '1';
          if (meta.b) a['data-pb-b'] = meta.b;
          if (meta.va) a['data-pb-va'] = meta.va;
          if (meta.fh) a['data-pb-fh'] = '1';
          // every column has a width: the table is exactly as wide as they add up to (see tableMeta.css; the editor's own style sheet insists on width:auto)
          let all = node.childCount > 0 && node.child(0).childCount > 0; let sum = 0;
          if (all) node.child(0).forEach((cell) => { const w = cell.attrs?.colwidth; if (!w || w.some((x) => !x)) all = false; else sum += w.reduce((p, q) => p + q, 0); });
          if (all) { a['data-pb-w'] = '1'; a.style = `--pb-tw:${sum}px`; }
          if (Object.keys(a).length) out.push(Decoration.node(pos, pos + node.nodeSize, a));
          if (Array.isArray(meta.rh)) {
            let off = pos + 1;
            node.forEach((row, _o, idx) => { const h = meta.rh[idx]; if (h > 0) out.push(Decoration.node(off, off + row.nodeSize, { style: `height:${h}px` })); off += row.nodeSize; });
          }
          return false;
        });
        lastDoc = state.doc; lastVer = ver; lastSet = DecorationSet.create(state.doc, out);
        return lastSet;
      },
    },
  });
}

