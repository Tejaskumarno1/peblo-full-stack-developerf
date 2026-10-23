// The River lanes draw at most 3 rows; anything stacked deeper used to vanish with no sign it was there.
// This groups those hidden items by where they sit, so each group can show a "+ N more" button.
export const MAX_LANE_ROWS = 3;

export function hiddenClusters(items, maxRows = MAX_LANE_ROWS, gap = 160) {
  const hidden = (items || []).filter((i) => i.row >= maxRows).sort((a, b) => a.x - b.x);
  const out = [];
  for (const h of hidden) {
    const last = out[out.length - 1];
    if (last && h.x - last.x < gap) last.items.push(h);
    else out.push({ x: h.x, items: [h] });
  }
  return out;
}

// The next hidden item to show when the button is pressed again (cycles through the group).
export function nextHidden(cluster, selectedId, idOf) {
  const i = cluster.items.findIndex((it) => idOf(it) === selectedId);
  const n = (i + 1) % cluster.items.length;
  return { item: cluster.items[n], position: n + 1, total: cluster.items.length };
}
