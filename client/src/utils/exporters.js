// Notes to Markdown, PDF, Word (.doc) or the printer. Runs in the browser; nothing is sent to a server.
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { downloadBlob, downloadText, safeFileName } from './download';
import { inlineMedia } from './imageData';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const mdToHtml = (md) => DOMPurify.sanitize(marked.parse(md || '', { async: false }));

/** docs: [{ title, content, tags }] */
export function docsToMarkdown(docs) {
  return docs.map((d) => {
    const tags = (d.tags || []).filter((t) => t !== 'inbox');
    return `# ${d.title || 'Untitled'}\n\n${tags.length ? `Topics: ${tags.map((t) => `#${t}`).join(' ')}\n\n` : ''}${d.content || ''}\n`;
  }).join('\n---\n\n');
}

export function docsToHtml(docs) {
  return docs.map((d) => {
    const tags = (d.tags || []).filter((t) => t !== 'inbox');
    return `<section class="pb-doc"><h1>${esc(d.title || 'Untitled')}</h1>${tags.length ? `<p class="pb-tags">${tags.map((t) => `#${esc(t)}`).join(' ')}</p>` : ''}${mdToHtml(d.content)}</section>`;
  }).join('\n');
}

export function docsToPlainText(docs) {
  return docs.map((d) => {
    const title = d.title || 'Untitled';
    const content = new DOMParser().parseFromString(mdToHtml(d.content), 'text/html').body.textContent || '';
    const tags = (d.tags || []).filter((t) => t !== 'inbox');
    return `${title}\n${'='.repeat(title.length)}\n\n${tags.length ? `Topics: ${tags.join(', ')}\n\n` : ''}${content.trim()}`;
  }).join('\n\n');
}

const PAGE_CSS = 'body{font-family:Georgia,"Times New Roman",serif;font-size:12pt;line-height:1.55;color:#111}h1{font-size:22pt;margin:0 0 6pt}h2{font-size:16pt}h3{font-size:13pt}.pb-tags{color:#555;font-size:10pt;margin:0 0 12pt}.pb-doc{page-break-after:always}.pb-doc:last-child{page-break-after:auto}pre,code{font-family:Consolas,monospace;font-size:10pt;background:#f3f3f3}pre{padding:8pt;white-space:pre-wrap}table{border-collapse:collapse}td,th{border:1px solid #999;padding:3pt 6pt}img{max-width:100%}blockquote{border-left:3pt solid #bbb;margin-left:0;padding-left:10pt;color:#444}';

export const wordPage = (title, html) =>
  `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PAGE_CSS}</style></head><body>${html}</body></html>`;

async function toPdf(html, filename) {
  const { default: html2pdf } = await import('html2pdf.js');
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:-10000px;top:0;width:740px;background:#fff;color:#111;padding:8px';
  el.innerHTML = `<style>${PAGE_CSS}</style>${html}`;
  document.body.appendChild(el);
  try {
    await html2pdf().set({ margin: 12, filename, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'mm', format: 'a4' }, pagebreak: { mode: ['css', 'legacy'] } }).from(el).save();
  } finally {
    el.remove();
  }
}

/** Prints through a hidden copy of the page content, so the printout has none of the app around it (see print.css). */
export function printHtml(html) {
  document.getElementById('peblo-print-root')?.remove();
  const root = document.createElement('div');
  root.id = 'peblo-print-root';
  root.innerHTML = `<style>${PAGE_CSS}</style>${html}`;
  document.body.appendChild(root);
  const clean = () => { root.remove(); window.removeEventListener('afterprint', clean); };
  window.addEventListener('afterprint', clean);
  window.print();
}

/** fmt: 'md' | 'pdf' | 'doc' | 'print' */
export async function exportDocs(docs, fmt, name) {
  if (!docs.length) throw new Error('There is nothing to export here yet.');
  const base = safeFileName(name || docs[0].title, 'peblo');
  docs = await Promise.all(docs.map(async (d) => ({ ...d, content: await inlineMedia(d.content) }))); // pictures stored on the server go inside the file
  if (fmt === 'md') return downloadText(`${base}.md`, docsToMarkdown(docs), 'text/markdown');
  const html = docsToHtml(docs);
  if (fmt === 'html') return downloadText(`${base}.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(base)}</title><style>${PAGE_CSS}</style></head><body>${html}</body></html>`, 'text/html');
  if (fmt === 'txt') return downloadText(`${base}.txt`, docsToPlainText(docs), 'text/plain');
  if (fmt === 'doc') return downloadBlob(`${base}.doc`, new Blob([wordPage(base, html)], { type: 'application/msword' }));
  if (fmt === 'pdf') return toPdf(html, `${base}.pdf`);
  if (fmt === 'print') return printHtml(html);
  throw new Error(`Unknown format ${fmt}`);
}
