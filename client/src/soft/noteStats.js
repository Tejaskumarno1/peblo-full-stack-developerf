// Word and character counts for a note. Pure, so the list rows and the note header agree.
// A word is a run of letters or digits. Markdown symbols, table borders, picture and link addresses are not words.

/** The readable text of a Markdown/HTML note: pictures, link targets, bare URLs, tables' borders and marker characters removed. */
export function plainOf(md) {
  return String(md || '')
    .replace(/<figure>[\s\S]*?<\/figure>/gi, ' ')
    .replace(/```[^\n]*\n?/g, ' ') // the fence lines of a code block (the code itself still counts)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // pictures
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // a link counts as its text, not its address
    .replace(/<[^>]*>/g, ' ')
    .replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, ' ') // bare URLs
    .replace(/^[\s|:+-]*$/gm, ' ') // table separator rows like |---|:--:| and horizontal rules
    .replace(/^[ 	]*(?:[-+*][ 	]+(?:\[[ xX]\][ 	]+)?|\d+[.)][ 	]+)/gm, ' ') // list and task markers
    .replace(/[|#*_>`~=]/g, ' ');
}

/** A word: at least one letter or digit (so "-", "--", "—" and "[ ]" do not count). */
const WORD = /[\p{L}\p{N}]/u;

export function countWords(md) {
  let n = 0;
  for (const t of plainOf(md).split(/\s+/)) if (t && WORD.test(t)) n += 1;
  return n;
}

export function noteStats(md) {
  const plain = plainOf(md);
  const words = countWords(md);
  const chars = plain.replace(/\s+/g, ' ').trim().length;
  return { words, chars, minutes: Math.max(1, Math.round(words / 200)) };
}
