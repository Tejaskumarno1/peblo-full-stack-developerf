// Pulls complete, fetchable URLs out of note text.
// Half-typed URLs ("https://", "https://exa") are skipped so the editor does not
// fire a preview request on every keystroke.
export function extractUrls(text) {
  if (!text) return [];
  const matches = String(text).match(/https?:\/\/[^\s)<>"']+/gi) || [];
  const seen = new Set();
  const out = [];
  for (const raw of matches) {
    const url = raw.replace(/[.,;:!?]+$/, '');
    let u;
    try { u = new URL(url); } catch { continue; }
    const host = u.hostname;
    // need a real host: a dot-separated name with a 2+ letter ending, or localhost
    if (!(host === 'localhost' || /\.[a-z]{2,}$/i.test(host))) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}
