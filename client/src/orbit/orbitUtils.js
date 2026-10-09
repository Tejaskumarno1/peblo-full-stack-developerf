// The map behind the Orbit screens: topics are tags, sized by notes, ringed by how well you know them.
import { startOfDay } from '../soft/softUtils.js';

const EXAM = /exam|test|viva|mid-?sem|finals?\b/i;
export const HIDDEN_TAGS = new Set(['inbox', 'private']);
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "sql-joins" → "SQL joins", "dbms" → "DBMS", "er-diagrams" → "ER diagrams". */
export function topicName(tag) {
  if (!tag) return '';
  const words = tag.split(/[-_\s]+/).filter(Boolean);
  const SMALL = new Set(['of', 'the', 'and', 'in', 'to', 'for', 'on', 'at', 'an', 'a', 'or', 'vs']);
  return words.map((w, i) => {
    if (i > 0 && SMALL.has(w.toLowerCase())) return w.toLowerCase();
    if (w.length <= 3 || !/[aeiouy]/i.test(w)) return w.toUpperCase();
    return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
  }).join(' ');
}

/** weak / ok / strong / none from a 0–100 score (none = never quizzed). */
export function levelOf(score) {
  if (score === null || score === undefined) return 'none';
  if (score < 50) return 'weak';
  if (score < 80) return 'ok';
  return 'strong';
}
export const LEVEL_LABEL = { weak: 'Weak', ok: 'Getting there', strong: 'Strong', none: 'Not quizzed' };
export const levelVar = (level) => `var(--o-${level})`;

export const tagsOfTodo = (t) => (Array.isArray(t?.todoTags) ? t.todoTags : []);
export const tagsOfNote = (n) => (Array.isArray(n?.tags) ? n.tags : []).filter((t) => !HIDDEN_TAGS.has(t));

/** "WED 7 OCT" */
export function shortDate(d) {
  const x = new Date(d);
  return `${DOW[x.getDay()]} ${x.getDate()} ${MON[x.getMonth()]}`;
}

/** A tag that works as a subject: its notes share at least two other tags (DBMS → normalization, joins…). */
export function pickSubject(notes) {
  for (const [tag] of tagCounts(notes)) {
    const inIt = notes.filter((n) => tagsOfNote(n).includes(tag));
    if (tagCounts(inIt).filter(([t]) => t !== tag).length >= 2) return tag;
  }
  return null;
}

/** Tags by how many notes have them. */
export function tagCounts(notes) {
  const m = new Map();
  for (const n of notes) for (const t of tagsOfNote(n)) m.set(t, (m.get(t) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const byRecent = (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt);
const byDue = (a, b) => new Date(a.deadline || 8.64e15) - new Date(b.deadline || 8.64e15);

/**
 * What the map shows for a space: the centre, the topics around it and a few notes and tasks on each.
 * space = null shows the whole map (your top tags); space = a tag shows the tags its notes share.
 * When a tag has fewer than two such sub-topics, its notes themselves go around it.
 */
export function buildGraph({ notes, todos, mastery, space, userName }) {
  const scoreOf = (tag) => mastery.get(tag)?.score ?? null;
  const open = todos.filter((t) => !t.completed);
  const center = { id: 'center', kind: 'center' };
  let sats = [];

  if (!space) {
    const top = tagCounts(notes).slice(0, 7);
    center.name = userName ? `${userName}'s map` : 'Your map';
    center.meta = `${notes.length} NOTES`;
    sats = top.map(([tag, count]) => ({ tag, count, notes: notes.filter((n) => tagsOfNote(n).includes(tag)) }));
  } else {
    const inSpace = notes.filter((n) => tagsOfNote(n).includes(space));
    center.name = topicName(space);
    center.tag = space;
    // What the space is working towards: the next exam if there is one, else the next deadline
    const upcoming = open.filter((t) => tagsOfTodo(t).includes(space) && t.deadline && new Date(t.deadline) >= startOfDay()).sort(byDue);
    const due = upcoming.find((t) => EXAM.test(t.text)) || upcoming[0];
    center.due = due || null;
    center.meta = due ? `${EXAM.test(due.text) ? 'EXAM' : 'DUE'} ${shortDate(due.deadline)}` : `${inSpace.length} NOTES`;
    const co = tagCounts(inSpace).filter(([t]) => t !== space).slice(0, 7);
    if (co.length >= 2) {
      sats = co.map(([tag, count]) => ({ tag, count, notes: inSpace.filter((n) => tagsOfNote(n).includes(tag)) }));
    } else {
      center.noteMode = true;
      sats = inSpace.sort(byRecent).slice(0, 7).map((n) => ({ note: n, count: Math.max(1, Math.round((n.content || '').length / 600)) }));
    }
  }

  const topics = sats.map((s, i) => {
    if (s.note) {
      const tasks = open.filter((t) => t.noteId === s.note.id).sort(byDue);
      return { id: `n-${s.note.id}`, kind: 'note', note: s.note, name: s.note.title || 'Untitled', count: s.count, tasks, leaves: tasks.slice(0, 2).map((t) => ({ kind: 'task', todo: t })), i };
    }
    const tasks = open.filter((t) => tagsOfTodo(t).includes(s.tag)).sort(byDue);
    const score = scoreOf(s.tag);
    const leaves = [
      ...s.notes.sort(byRecent).slice(0, tasks.length ? 1 : 2).map((n) => ({ kind: 'note', note: n })),
      ...tasks.slice(0, 1).map((t) => ({ kind: 'task', todo: t })),
    ];
    return { id: `t-${s.tag}`, kind: 'topic', tag: s.tag, name: topicName(s.tag), count: s.notes.length, notes: s.notes, tasks, score, level: levelOf(score), leaves, i };
  });

  // How ready the space is: the average of the topics that have been quizzed
  const quizzed = topics.filter((t) => t.kind === 'topic' && t.score !== null);
  center.ready = quizzed.length ? Math.round(quizzed.reduce((a, t) => a + t.score, 0) / quizzed.length) : null;
  return { center, topics };
}

/**
 * Places the centre, the topics on an ellipse around it, and each topic's leaves further out.
 * Returns positions in map pixels (the map's top-left is 0,0 before panning).
 */
export function layoutGraph(graph, { width, height, right = 380 }) {
  const left = 110;
  const top = 96;
  const bottom = height - 110;
  const mapRight = width - right;
  const cx = Math.round((left + mapRight) / 2);
  const cy = Math.round((top + bottom) / 2) + 6;
  const n = graph.topics.length;
  const rx = Math.min(310, (mapRight - left) / 2 - 130);
  const ry = Math.min(240, (bottom - top) / 2 - 70);

  const nodes = graph.topics.map((t, i) => {
    const a = (-140 + (360 / Math.max(n, 1)) * i) * (Math.PI / 180);
    const d = Math.round(84 + Math.min(t.count, 8) * 6);
    return { ...t, a, d, x: Math.round(cx + rx * Math.cos(a)), y: Math.round(cy + ry * Math.sin(a)) };
  });

  const leaves = [];
  for (const node of nodes) {
    const k = node.leaves.length;
    node.leaves.forEach((leaf, j) => {
      const spread = k === 1 ? 0 : (j - (k - 1) / 2) * 0.62;
      const a = node.a + spread;
      const dist = node.d / 2 + 104;
      const text = leaf.kind === 'note' ? (leaf.note.title || 'Untitled') : `${leaf.todo.text} · due Tomorrow`;
      const w = Math.min(240, 46 + text.length * 6.6);
      leaves.push({ ...leaf, w, from: node.id, fx: node.x, fy: node.y, x: node.x + dist * Math.cos(a) * 1.25, y: node.y + dist * Math.sin(a) });
    });
  }

  // Keep leaves on the map (clear of the tools on the left and the card on the right),
  // off the topic circles and off each other.
  const minX = (l) => 100 + l.w / 2;
  const maxX = (l) => mapRight + 25 - l.w / 2;
  const minY = top + 20;
  const maxY = height - 112;
  const clamp = (l) => {
    l.x = Math.max(minX(l), Math.min(maxX(l), l.x));
    l.y = Math.max(minY, Math.min(maxY, l.y));
  };
  const blocks = [{ x: cx, y: cy, r: 80 + 14 }, ...nodes.map((nd) => ({ x: nd.x, y: nd.y, r: nd.d / 2 + 12 }))];
  leaves.forEach(clamp);
  for (let it = 0; it < 60; it++) {
    let moved = false;
    for (let i = 0; i < leaves.length; i++) {
      const a = leaves[i];
      for (let j = i + 1; j < leaves.length; j++) {
        const b = leaves[j];
        const ox = (a.w + b.w) / 2 + 8 - Math.abs(a.x - b.x);
        const oy = 40 - Math.abs(a.y - b.y);
        if (ox > 0 && oy > 0) {
          const dir = a.y <= b.y ? -1 : 1;
          a.y += (dir * oy) / 2;
          b.y -= (dir * oy) / 2;
          moved = true;
        }
      }
      for (const c of blocks) {
        // nearest point of the leaf's box to the circle's centre (circles keep a label below them)
        const px = Math.max(a.x - a.w / 2, Math.min(c.x, a.x + a.w / 2));
        const py = Math.max(a.y - 16, Math.min(c.y, a.y + 16));
        const dx = px - c.x;
        const dy = py - c.y;
        const dist = Math.hypot(dx, dy);
        const need = c.r + (dy > 0 ? 30 : 0);
        if (dist < need) {
          const ux = dist ? dx / dist : 0;
          const uy = dist ? dy / dist : 1;
          a.x += ux * (need - dist);
          a.y += uy * (need - dist);
          moved = true;
        }
      }
      clamp(a);
    }
    if (!moved) break;
  }
  leaves.forEach((l) => { l.x = Math.round(l.x); l.y = Math.round(l.y); });
  return { cx, cy, centerD: 160, nodes, leaves };
}

/**
 * The topics to revise first: the weakest quizzed ones, up to three.
 * Before any quiz, the biggest topics, so the first quizzes show where you stand.
 */
export function revisionPath(nodes) {
  const topics = nodes.filter((t) => t.kind === 'topic');
  // Weakest quizzed topics first, then topics never quizzed (biggest first) so new topics are not hidden by one strong one
  const weak = topics.filter((t) => t.score !== null && t.score < 80).sort((a, b) => a.score - b.score);
  const fresh = topics.filter((t) => t.score === null).sort((a, b) => b.count - a.count);
  const steps = [...weak, ...fresh].slice(0, 3);
  const minutes = steps.reduce((m, t) => m + (t.score === null || t.score < 50 ? 35 : 20), 0);
  return { steps, minutes };
}

export function minutesText(m) {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h${m % 60 ? ` ${m % 60} m` : ''}`;
}

/** "4 days ago", "today", "yesterday" */
export function agoText(date) {
  const days = Math.round((startOfDay() - startOfDay(date)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
