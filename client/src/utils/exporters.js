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

function pdfBlocks(html) {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const blocks = [];
  const textOf = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    if (node.tagName === 'BR') return '\n';
    if (node.tagName === 'IMG') return node.getAttribute('alt') || '[Image]';
    return [...node.childNodes].map(textOf).join('');
  };
  const visit = (node, indent = 0) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName;
    if (/^H[1-6]$/.test(tag)) {
      blocks.push({ type: 'heading', level: Number(tag.slice(1)), text: textOf(node).trim() });
    } else if (tag === 'P') {
      const text = textOf(node).trim();
      if (text) blocks.push({ type: 'paragraph', text, indent });
    } else if (tag === 'UL' || tag === 'OL') {
      [...node.children].filter((child) => child.tagName === 'LI').forEach((item, index) => {
        const clone = item.cloneNode(true);
        clone.querySelectorAll('ul, ol').forEach((nested) => nested.remove());
        const checkbox = clone.querySelector('input[type="checkbox"]');
        const marker = checkbox ? (checkbox.checked ? '[x] ' : '[ ] ') : `${tag === 'OL' ? `${index + 1}.` : '•'} `;
        const text = textOf(clone).trim();
        if (text || checkbox) blocks.push({ type: 'paragraph', text: `${marker}${text}`, indent });
        [...item.children].filter((child) => child.tagName === 'UL' || child.tagName === 'OL').forEach((nested) => visit(nested, indent + 5));
      });
    } else if (tag === 'PRE') {
      blocks.push({ type: 'code', text: node.textContent || '', indent });
    } else if (tag === 'BLOCKQUOTE') {
      [...node.children].forEach((child) => visit(child, indent + 5));
    } else if (tag === 'HR') {
      blocks.push({ type: 'rule' });
    } else if (tag === 'TABLE') {
      [...node.querySelectorAll('tr')].forEach((row) => {
        const cells = [...row.querySelectorAll('th,td')].map((cell) => textOf(cell).trim());
        if (cells.some(Boolean)) blocks.push({ type: 'paragraph', text: cells.join('  |  '), indent });
      });
    } else if (tag === 'IMG') {
      blocks.push({ type: 'paragraph', text: textOf(node), indent });
    } else {
      [...node.childNodes].forEach((child) => visit(child, indent));
    }
  };
  [...parsed.body.childNodes].forEach((node) => visit(node));
  return blocks;
}

export const wordPage = (title, html) =>
  `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PAGE_CSS}</style></head><body>${html}</body></html>`;

async function toPdf(html, filename) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const blocks = pdfBlocks(html);
  if (!blocks.length) throw new Error('This note has no printable content.');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 18;
  const maxY = pageHeight - margin;
  let y = margin;
  const ensureRoom = (height) => {
    if (y + height > maxY) { pdf.addPage(); y = margin; }
  };
  const writeText = (text, { size = 11, font = 'normal', indent = 0, color = [36, 31, 26], gap = 0 } = {}) => {
    pdf.setFont('helvetica', font);
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
    const lineHeight = size * 0.48;
    const lines = pdf.splitTextToSize(text || ' ', pageWidth - margin * 2 - indent);
    lines.forEach((line) => {
      ensureRoom(lineHeight);
      pdf.text(line, margin + indent, y);
      y += lineHeight;
    });
    y += gap;
  };
  blocks.forEach((block) => {
    if (block.type === 'rule') {
      ensureRoom(6);
      pdf.setDrawColor(205, 195, 183);
      pdf.line(margin, y, pageWidth - margin, y);
      y += 7;
      return;
    }
    if (block.type === 'heading') {
      const size = block.level === 1 ? 20 : block.level === 2 ? 16 : 13;
      y += block.level === 1 ? 2 : 5;
      writeText(block.text, { size, font: 'bold', color: [36, 31, 26], gap: 2 });
      return;
    }
    if (block.type === 'code') {
      y += 2;
      writeText(block.text, { size: 9, font: 'normal', indent: block.indent, color: [55, 55, 55], gap: 3 });
      return;
    }
    writeText(block.text, { indent: block.indent, gap: 2 });
  });
  for (let page = 1; page <= pdf.getNumberOfPages(); page++) {
    pdf.setPage(page);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(120, 112, 103);
    pdf.text(`${page} / ${pdf.getNumberOfPages()}`, pageWidth - margin, pageHeight - 8, { align: 'right' });
  }
  pdf.save(filename);
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
