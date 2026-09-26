// Turns a Notion export (Markdown & CSV .zip), an Obsidian vault .zip, or loose
// Markdown/CSV files into plain note records that Peblo can store.
import AdmZip from 'adm-zip';
import path from 'path';

export interface ImportedNote {
  title: string;
  content: string;
  tags: string[];
  createdAt?: Date;
  source: string;
}

export interface ImportResult {
  notes: ImportedNote[];
  skippedImages: number;
  skippedFiles: string[];
}

const NOTION_ID = /[\s_-]+[0-9a-f]{32}$/i;
const TEXT_EXT = new Set(['.md', '.markdown', '.txt']);

/** "Meeting notes 1a2b…(32 hex)" → "Meeting notes" */
export function cleanName(fileName: string): string {
  const base = path.basename(fileName).replace(/\.(md|markdown|txt|csv)$/i, '');
  return base.replace(/_all$/i, '').replace(NOTION_ID, '').trim() || 'Untitled';
}

function splitTags(value: string): string[] {
  return value
    .replace(/^\[|\]$/g, '')
    .split(/[,;]/)
    .map((t) => t.trim().replace(/^["'#]|["']$/g, '').toLowerCase())
    .filter(Boolean);
}

function parseDate(value: string): Date | undefined {
  const d = new Date(value.replace(/\s*\(.*\)\s*$/, ''));
  return isNaN(d.getTime()) ? undefined : d;
}

/** Parses one Markdown page from Notion/Obsidian into a note. */
export function parseMarkdownPage(fileName: string, raw: string, result: ImportResult): ImportedNote {
  let text = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const tags: string[] = [];
  let createdAt: Date | undefined;
  let title = cleanName(fileName);

  // Obsidian / generic YAML front matter
  const fm = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const m = line.match(/^(tags|tag|keywords|created|date|title)\s*:\s*(.*)$/i);
      if (!m) continue;
      const key = m[1].toLowerCase();
      if (key.startsWith('tag') || key === 'keywords') tags.push(...splitTags(m[2]));
      else if (key === 'title' && m[2].trim()) title = m[2].trim().replace(/^["']|["']$/g, '');
      else createdAt = createdAt || parseDate(m[2]);
    }
    // YAML list form:  tags:\n  - a\n  - b
    const list = fm[1].match(/^tags:\s*\n((?:\s*-\s*.+\n?)+)/im);
    if (list) tags.push(...list[1].split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim().toLowerCase()).filter(Boolean));
    text = text.slice(fm[0].length);
  }

  // Leading "# Title" (Notion always writes one)
  const h1 = text.match(/^\s*#\s+(.+)\n?/);
  if (h1) {
    title = h1[1].trim();
    text = text.slice(h1[0].length);
  }

  // Notion page properties: "Key: value" lines right under the title
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  const kept: string[] = [];
  while (i < lines.length) {
    const m = lines[i].match(/^([A-Z][\w .&/-]{0,40}):\s+(.+)$/);
    if (!m) break;
    const key = m[1].trim().toLowerCase();
    if (['tags', 'tag', 'labels', 'multi-select', 'category'].includes(key)) tags.push(...splitTags(m[2]));
    else if (['created', 'created time', 'date created', 'date'].includes(key)) createdAt = createdAt || parseDate(m[2]);
    else kept.push(`**${m[1].trim()}:** ${m[2].trim()}`);
    i++;
  }
  let body = lines.slice(i).join('\n');
  if (kept.length) body = `${kept.join('  \n')}\n\n${body}`;

  // Images live as separate files in the export; they aren't imported yet.
  body = body.replace(/!\[[^\]]*\]\((?!https?:)[^)]*\)\n?/g, () => {
    result.skippedImages++;
    return '';
  });
  // Links to other exported pages ("Other%20Page%20<id>.md") become plain text.
  body = body.replace(/\[([^\]]+)\]\((?!https?:)[^)]*\.(md|csv)\)/gi, '$1');

  return {
    title: title.slice(0, 300),
    content: body.trim(),
    tags: [...new Set(tags)].slice(0, 20),
    createdAt,
    source: fileName,
  };
}

/** Minimal RFC-4180 CSV parser (quoted fields, escaped quotes, newlines inside quotes). */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

/** A Notion database (CSV) becomes one note holding a Markdown table. */
export function csvToNote(fileName: string, text: string): ImportedNote | null {
  const rows = parseCSV(text);
  if (rows.length === 0) return null;
  const width = Math.max(...rows.map((r) => r.length));
  const cell = (v: string | undefined) => (v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
  const header = rows[0];
  const lines = [
    `| ${Array.from({ length: width }, (_, i) => cell(header[i]) || ' ').join(' | ')} |`,
    `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
    ...rows.slice(1).map((r) => `| ${Array.from({ length: width }, (_, i) => cell(r[i])).join(' | ')} |`),
  ];
  return {
    title: cleanName(fileName),
    content: `Imported table with ${rows.length - 1} row${rows.length === 2 ? '' : 's'}.\n\n${lines.join('\n')}`,
    tags: ['table'],
    source: fileName,
  };
}

function ingestFiles(files: { name: string; data: Buffer }[], result: ImportResult, depth = 0) {
  const names = new Set(files.map((f) => f.name.toLowerCase()));
  for (const file of files) {
    const lower = file.name.toLowerCase();
    const ext = path.extname(lower);
    const base = path.basename(file.name);
    if (base.startsWith('.') || lower.includes('__macosx/')) continue;

    if (ext === '.zip') {
      if (depth > 3) { result.skippedFiles.push(file.name); continue; }
      const inner = new AdmZip(file.data)
        .getEntries()
        .filter((e) => !e.isDirectory)
        .map((e) => ({ name: e.entryName, data: e.getData() }));
      ingestFiles(inner, result, depth + 1);
    } else if (TEXT_EXT.has(ext)) {
      const note = parseMarkdownPage(file.name, file.data.toString('utf8'), result);
      if (note.content || note.title !== 'Untitled') result.notes.push(note);
    } else if (ext === '.csv') {
      // Notion writes both "DB.csv" (current view) and "DB_all.csv" (every row); keep only the full one.
      if (!lower.endsWith('_all.csv') && names.has(lower.replace(/\.csv$/, '_all.csv'))) continue;
      const note = csvToNote(file.name, file.data.toString('utf8'));
      if (note) result.notes.push(note);
    } else if (/\.(png|jpe?g|gif|webp|svg|bmp)$/.test(ext)) {
      // counted when referenced from a page
    } else {
      result.skippedFiles.push(file.name);
    }
  }
}

export function parseUploads(files: { originalname: string; buffer: Buffer }[]): ImportResult {
  const result: ImportResult = { notes: [], skippedImages: 0, skippedFiles: [] };
  ingestFiles(files.map((f) => ({ name: f.originalname, data: f.buffer })), result);
  return result;
}

/** Builds a .zip of every note as a Markdown file (for backups / leaving Peblo). */
export function buildMarkdownExport(notes: { title: string; content: string; tags: string[]; createdAt: Date; updatedAt: Date; isArchived: boolean }[]): Buffer {
  const zip = new AdmZip();
  const used = new Map<string, number>();
  for (const n of notes) {
    const safe = (n.title || 'Untitled').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim().slice(0, 120) || 'Untitled';
    const count = used.get(safe.toLowerCase()) || 0;
    used.set(safe.toLowerCase(), count + 1);
    const fileName = `${n.isArchived ? 'Archive/' : ''}${count ? `${safe} (${count + 1})` : safe}.md`;
    const front = [
      '---',
      `title: ${JSON.stringify(n.title || 'Untitled')}`,
      `tags: [${n.tags.map((t) => JSON.stringify(t)).join(', ')}]`,
      `created: ${n.createdAt.toISOString()}`,
      `updated: ${n.updatedAt.toISOString()}`,
      '---',
      '',
    ].join('\n');
    zip.addFile(fileName, Buffer.from(`${front}# ${n.title || 'Untitled'}\n\n${n.content || ''}\n`, 'utf8'));
  }
  return zip.toBuffer();
}
