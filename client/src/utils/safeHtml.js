// Markdown -> HTML that is safe to put in the page (PEB-61).
// AI replies, notes and imported text can contain <script>, onerror= handlers or javascript: links.
// Every dangerouslySetInnerHTML / export template goes through here.
import { marked } from 'marked';
import DOMPurify from 'dompurify';

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeHtml(html) {
  return DOMPurify.sanitize(String(html ?? ''));
}

export function renderMarkdown(text, options) {
  return sanitizeHtml(marked.parse(typeof text === 'string' ? text : String(text ?? ''), options));
}
