// Turns "call mom tomorrow !high #family" into a task: text, due date, priority and tags.
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Pulls simple shortcuts out of a task line:
 *   "call mom tomorrow !high #family" → text "call mom", due tomorrow, high priority, tag family
 * Supports: today, tonight, tomorrow, weekday names ("friday", "next monday"), !high/!low, #tags.
 */
export function parseTask(input) {
  let text = ` ${input.trim()} `;
  let priority = 'medium';
  const tags = [];
  let deadline = null;

  text = text.replace(/\s!(high|h|urgent|low|l|medium|med|m)\b/gi, (_, p) => {
    const v = p.toLowerCase();
    priority = v.startsWith('h') || v === 'urgent' ? 'high' : v.startsWith('l') ? 'low' : 'medium';
    return ' ';
  });
  text = text.replace(/\s#([\p{L}\p{N}_-]+)/gu, (_, t) => { tags.push(t.toLowerCase()); return ' '; });

  const now = new Date();
  const at = (d) => { const x = new Date(d); x.setHours(17, 0, 0, 0); return x; };
  text = text.replace(/\s(today|tonight)\b/i, () => { deadline = at(now); return ' '; });
  text = text.replace(/\s(tomorrow|tmrw|tmr)\b/i, () => { const d = new Date(now); d.setDate(d.getDate() + 1); deadline = at(d); return ' '; });
  text = text.replace(/\s(?:on\s|next\s)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i, (m, day) => {
    const target = WEEKDAYS.indexOf(day.toLowerCase());
    const d = new Date(now);
    let diff = (target - d.getDay() + 7) % 7;
    if (diff === 0 || /next/i.test(m)) diff += diff === 0 ? 7 : 0;
    d.setDate(d.getDate() + diff);
    deadline = at(d);
    return ' ';
  });

  return { text: text.replace(/\s+/g, ' ').trim(), priority, tags, deadline };
}
