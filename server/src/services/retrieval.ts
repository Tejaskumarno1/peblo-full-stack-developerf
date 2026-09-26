// "Ask your notes" retrieval for the AI Hub.
//
// Phase-1 version: keyword scoring over notes and tasks in SQLite (no embeddings yet).
// The shape of what it returns (numbered sources with snippets) is what the AI Hub,
// citations and the Sources panel depend on, so a later hybrid FTS5 + vector search
// (docs/04-ai-hub.md) can replace the scoring without touching callers.
import prisma from '../db.js';

export interface Source {
  n: number;
  kind: 'note' | 'task' | 'agenda';
  id: string | null;
  title: string;
  meta: string;
  snippet: string;
  /** Text given to the model for this source. */
  text: string;
}

export interface RetrievalResult {
  sources: Source[];
  searched: { notes: number; tasks: number };
  excludedPrivate: number;
}

const STOP = new Set(
  ('a an and are as at be by can do does for from has have how i in is it its me my of on or our so ' +
    'that the this to was what when where which who why will with you your about into than then them ' +
    'there these they tell give make show please any all just more most some need want like get got')
    .split(' ')
);

const TIME_WORDS = /\b(today|tonight|tomorrow|week|weekend|plan|schedule|agenda|deadline|deadlines|due|exam|exams|upcoming|monday|tuesday|wednesday|thursday|friday|saturday|sunday|calendar|busy|free)\b/i;

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length > 2 && !STOP.has(w));
}

function relTime(d: Date): string {
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 1)} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

function fmtDue(d: Date | null): string {
  if (!d) return 'no due date';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) +
    ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function snippetAround(text: string, words: string[], size = 170): string {
  const plain = text.replace(/[#*_>`|[\]()-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const lower = plain.toLowerCase();
  let at = -1;
  for (const w of words) {
    at = lower.indexOf(w);
    if (at >= 0) break;
  }
  if (at < 0) return plain.slice(0, size) + (plain.length > size ? '…' : '');
  const start = Math.max(0, at - 50);
  return (start > 0 ? '…' : '') + plain.slice(start, start + size) + (start + size < plain.length ? '…' : '');
}

export async function retrieve(
  userId: string,
  query: string,
  opts: { noteIds?: string[]; maxNotes?: number } = {}
): Promise<RetrievalResult> {
  const words = [...new Set(tokens(query))];
  const maxNotes = opts.maxNotes ?? 5;

  const [notes, tasks] = await Promise.all([
    prisma.note.findMany({
      where: { userId, isDeleted: false },
      select: { id: true, title: true, content: true, updatedAt: true, tags: { select: { tag: { select: { name: true } } } } },
    }),
    prisma.todo.findMany({
      where: { userId, completed: false },
      select: { id: true, text: true, deadline: true, priority: true, todoTags: true },
      orderBy: { deadline: 'asc' },
    }),
  ]);

  // Notes tagged #private are never shown to any model.
  const visible = notes.filter((n) => !n.tags.some((t) => t.tag.name === 'private'));
  const excludedPrivate = notes.length - visible.length;

  const scoreText = (title: string, body: string) => {
    const t = title.toLowerCase();
    const b = body.toLowerCase();
    let s = 0;
    for (const w of words) {
      if (t.includes(w)) s += 4;
      const hits = b.split(w).length - 1;
      s += Math.min(hits, 5);
    }
    return s;
  };

  const attached = new Set(opts.noteIds || []);
  const scored = visible
    .map((n) => ({
      n,
      score: (attached.has(n.id) ? 1000 : 0) + scoreText(n.title, n.content + ' ' + n.tags.map((t) => t.tag.name).join(' ')),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.n.updatedAt.getTime() - a.n.updatedAt.getTime())
    .slice(0, Math.max(maxNotes, attached.size));

  const sources: Source[] = [];
  for (const { n } of scored) {
    const tags = n.tags.map((t) => '#' + t.tag.name);
    sources.push({
      n: sources.length + 1,
      kind: 'note',
      id: n.id,
      title: n.title || 'Untitled',
      meta: ['Note', ...tags.slice(0, 2), 'edited ' + relTime(n.updatedAt)].join(' · '),
      snippet: snippetAround(n.content || n.title, words),
      text: (n.content || '').slice(0, 1800),
    });
  }

  const matchingTasks = tasks
    .map((t) => ({ t, score: scoreText(t.text, (Array.isArray(t.todoTags) ? t.todoTags : []).join(' ')) }))
    .filter((x) => x.score > 0)
    .slice(0, 3);
  for (const { t } of matchingTasks) {
    sources.push({
      n: sources.length + 1,
      kind: 'task',
      id: t.id,
      title: t.text,
      meta: `Task · ${t.priority} · due ${fmtDue(t.deadline)}`,
      snippet: `Due ${fmtDue(t.deadline)} · ${t.priority} priority`,
      text: `Open task: "${t.text}" (priority ${t.priority}, due ${fmtDue(t.deadline)})`,
    });
  }

  // Questions about time ("plan my weekend") also get the next 7 days of open tasks.
  if (TIME_WORDS.test(query)) {
    const weekAhead = new Date(Date.now() + 7 * 86400000);
    const upcoming = tasks.filter((t) => t.deadline && t.deadline <= weekAhead).slice(0, 12);
    if (upcoming.length) {
      sources.push({
        n: sources.length + 1,
        kind: 'agenda',
        id: null,
        title: 'Your next 7 days',
        meta: `Agenda · ${upcoming.length} open task${upcoming.length === 1 ? '' : 's'}`,
        snippet: upcoming.slice(0, 3).map((t) => `${fmtDue(t.deadline)} · ${t.text}`).join('\n'),
        text: upcoming.map((t) => `- ${fmtDue(t.deadline)}: ${t.text} (${t.priority})`).join('\n'),
      });
    }
  }

  return { sources, searched: { notes: visible.length, tasks: tasks.length }, excludedPrivate };
}

export function sourcesPrompt(sources: Source[]): string {
  if (!sources.length) return '';
  const parts = sources.map((s) => `[${s.n}] ${s.kind === 'note' ? 'Note' : s.kind === 'task' ? 'Task' : 'Agenda'}: ${s.title} (${s.meta})\n${s.text}`);
  let text = parts.join('\n\n');
  if (text.length > 7000) text = text.slice(0, 7000) + '\n…';
  return `\n\n---\nSources from the user's Peblo (cite them as [n]):\n\n${text}`;
}
