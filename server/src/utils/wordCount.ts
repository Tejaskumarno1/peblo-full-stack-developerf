// Word count for the light notes list. Keep in step with client/src/soft/noteStats.js (same rules, tested there):
// a word is a run with at least one letter or digit; Markdown symbols, table borders, picture and link addresses are not words.
export function countWords(md: unknown): number {
  const plain = String(md || '')
    .replace(/<figure>[\s\S]*?<\/figure>/gi, ' ')
    .replace(/```[^\n]*\n?/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, ' ')
    .replace(/^[\s|:+-]*$/gm, ' ')
    .replace(/^[ \t]*(?:[-+*][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+)/gm, ' ')
    .replace(/[|#*_>`~=]/g, ' ');
  let n = 0;
  for (const t of plain.split(/\s+/)) if (t && /[\p{L}\p{N}]/u.test(t)) n += 1;
  return n;
}
