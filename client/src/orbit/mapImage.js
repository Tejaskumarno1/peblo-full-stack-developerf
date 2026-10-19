// Orbit · draw the map as a standalone SVG (and PNG) so it can be saved or printed.
const LEVEL_HEX = { weak: '#D64545', ok: '#D99A00', strong: '#2E9E5B', none: '#9AA3B2' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * nodes: [{ x, y, d, name, kind, level, count, tag }]; center: { name }; cx, cy: centre position.
 * colours / icons: { tag: '#hex' } and { tag: 'emoji' } picked in Manage topics.
 */
export function mapToSvg({ nodes, center, cx, cy, colours = {}, icons = {}, title = 'Peblo map' }) {
  const pts = [{ x: cx, y: cy, r: 90 }, ...nodes.map((n) => ({ x: n.x, y: n.y, r: n.d / 2 + 28 }))];
  const x0 = Math.min(...pts.map((p) => p.x - p.r)) - 20;
  const y0 = Math.min(...pts.map((p) => p.y - p.r)) - 40;
  const x1 = Math.max(...pts.map((p) => p.x + p.r)) + 20;
  const y1 = Math.max(...pts.map((p) => p.y + p.r)) + 20;
  const w = Math.round(x1 - x0);
  const h = Math.round(y1 - y0);
  const lines = nodes.map((n) => `<line x1="${Math.round(cx)}" y1="${Math.round(cy)}" x2="${Math.round(n.x)}" y2="${Math.round(n.y)}" stroke="#C9CFDA" stroke-width="1.5"/>`).join('');
  const circles = nodes.map((n) => {
    const ring = n.kind === 'topic' ? (LEVEL_HEX[n.level] || LEVEL_HEX.none) : '#C9CFDA';
    const fill = n.kind === 'topic' && colours[n.tag] ? `${colours[n.tag]}33` : '#FFFFFF';
    const label = `${n.kind === 'topic' && icons[n.tag] ? `${icons[n.tag]} ` : ''}${n.name}`;
    const sub = n.kind === 'topic' ? `${n.count} note${n.count === 1 ? '' : 's'}` : '';
    return `<g><circle cx="${Math.round(n.x)}" cy="${Math.round(n.y)}" r="${Math.round(n.d / 2)}" fill="${fill}" stroke="${ring}" stroke-width="3"/>`
      + `<text x="${Math.round(n.x)}" y="${Math.round(n.y)}" text-anchor="middle" font-size="14" font-weight="600" fill="#1B2030">${esc(label)}</text>`
      + (sub ? `<text x="${Math.round(n.x)}" y="${Math.round(n.y) + 18}" text-anchor="middle" font-size="11" fill="#667">${esc(sub)}</text>` : '')
      + '</g>';
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${Math.round(x0)} ${Math.round(y0)} ${w} ${h}" font-family="system-ui, sans-serif">`
    + `<title>${esc(title)}</title><rect x="${Math.round(x0)}" y="${Math.round(y0)}" width="${w}" height="${h}" fill="#FFFFFF"/>`
    + `${lines}<circle cx="${Math.round(cx)}" cy="${Math.round(cy)}" r="70" fill="#E8EDFF" stroke="#2350FF" stroke-width="3"/>`
    + `<text x="${Math.round(cx)}" y="${Math.round(cy) + 5}" text-anchor="middle" font-size="18" font-weight="700" fill="#1B2030">${esc(center?.name || 'Map')}</text>${circles}</svg>`;
}

/** Draw an SVG string onto a canvas and resolve a PNG blob. */
export function svgToPng(svg, scale = 2) {
  return new Promise((resolve, reject) => {
    const m = /width="(\d+)" height="(\d+)"/.exec(svg);
    const w = Number(m?.[1] || 800);
    const h = Number(m?.[2] || 600);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = w * scale; c.height = h * scale;
      const ctx = c.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, w, h);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the PNG'))), 'image/png');
    };
    img.onerror = () => reject(new Error('Could not draw the map'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}
