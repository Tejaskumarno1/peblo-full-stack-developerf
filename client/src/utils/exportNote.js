// Downloads for notes (the same files Soft Studio makes): Markdown, Word and PDF, one note or many.
import { marked } from 'marked';
import { inlineMedia } from './imageData';
import { sanitizeHtml } from './safeHtml';

const baseName = (n) => (n.title || 'Untitled').replace(/[^\p{L}\p{N}_\s-]/gu, '').trim().replace(/\s+/g, '_') || 'note';

function save(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const md = async (n) => `# ${n.title || 'Untitled'}\n\n${await inlineMedia(n.content || '')}`;
const html = async (n) => sanitizeHtml(`<h1>${(n.title || 'Untitled').replace(/</g, '&lt;')}</h1>${marked.parse(await inlineMedia(n.content || ''))}`);

export async function exportMarkdown(n) {
  save(new Blob([await md(n)], { type: 'text/markdown' }), `${baseName(n)}.md`);
}

/** Several notes in one Markdown file, a rule between them. */
export async function exportManyMarkdown(notes) {
  const parts = [];
  for (const n of notes) parts.push(await md(n));
  save(new Blob([parts.join('\n\n---\n\n')], { type: 'text/markdown' }), `peblo-notes-${notes.length}.md`);
}

export async function exportWord(n) {
  const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${baseName(n)}</title></head><body style="font-family:Calibri,Arial,sans-serif">${await html(n)}</body></html>`;
  save(new Blob(['﻿', doc], { type: 'application/msword' }), `${baseName(n)}.doc`);
}

export async function exportPdf(n) {
  const { default: html2pdf } = await import('html2pdf.js');
  const el = document.createElement('div');
  el.style.cssText = 'font-family:Arial,sans-serif;font-size:13px;line-height:1.5;padding:8px;color:#111;max-width:680px';
  el.innerHTML = await html(n);
  el.querySelectorAll('img').forEach((i) => { i.style.maxWidth = '100%'; });
  await html2pdf().set({ margin: 14, filename: `${baseName(n)}.pdf`, image: { type: 'jpeg', quality: 0.92 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4' } }).from(el).save();
}
