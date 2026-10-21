// The extra things Quick add understands besides the day and time (those come from parseTask / parseTimes):
// "every weekday", "for 30 min", "remind 10 min before", "with Priya and Sam", "by Sunday".
// Returns the line with those phrases taken out (so the date parser sees clean text) plus what they said.

const WEEKDAYS = 'sunday|monday|tuesday|wednesday|thursday|friday|saturday';
const NOT_NAMES = new Set(['today', 'tonight', 'tomorrow', 'noon', 'midnight', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'next', 'this', 'every']);

const minutes = (n, unit) => Math.round(Number(n) * (/^h/i.test(unit) ? 60 : 1));

export function extras(raw, mode) {
  let line = ` ${String(raw || '')} `;
  let recurrence = null;
  let durMin = null;
  let remindMin = null;

  // every weekday / every day / every week / every month / every year / every friday
  line = line.replace(new RegExp(String.raw`\severy\s+(weekdays?|day|week|month|year|${WEEKDAYS})(?![\w-])`, 'i'), (_, w) => {
    const k = w.toLowerCase();
    if (k.startsWith('weekday')) recurrence = 'weekdays';
    else if (k === 'day') recurrence = 'daily';
    else if (k === 'week') recurrence = 'weekly';
    else if (k === 'month') recurrence = 'monthly';
    else if (k === 'year') recurrence = 'yearly';
    else { recurrence = 'weekly'; return ` ${k} `; } // "every friday" repeats weekly and starts on the next Friday
    return ' ';
  });

  line = line.replace(/\sfor\s+(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)(?![\w])/i, (_, n, unit) => {
    durMin = minutes(n, unit);
    return ' ';
  });
  line = line.replace(/\sremind(?:\s+me)?\s+(\d+)\s*(hours?|hrs?|h|minutes?|mins?|m)\s+before(?![\w])/i, (_, n, unit) => {
    remindMin = minutes(n, unit);
    return ' ';
  });
  // "due by sunday" -> "due sunday"
  line = line.replace(new RegExp(String.raw`\sby\s+(?=(?:${WEEKDAYS}|tomorrow|tmrw|today|tonight|noon|\d))`, 'i'), ' ');

  // People: "with Priya, Sam and Ravi" or a leading "Call Priya". Capital letters only, so "with friday" is not a person.
  const people = [];
  const add = (s) => {
    for (const n of s.split(/\s*(?:,|&|\band\b)\s*/)) {
      const name = n.trim();
      if (name && /^[A-Z]/.test(name) && !NOT_NAMES.has(name.toLowerCase()) && !people.includes(name)) people.push(name);
    }
  };
  const w = String(raw || '').match(/\bwith\s+([A-Z][\w'’-]*(?:\s*(?:,|&|and)\s*[A-Z][\w'’-]*)*)/);
  if (w) add(w[1]);
  const lead = String(raw || '').match(/^\s*(?:[Cc]all|[Mm]eet|[Pp]ing|[Ss]ync with|1:1 with)\s+([A-Z][\w'’-]*)/);
  if (lead) add(lead[1]);

  return {
    line: line.replace(/\s+/g, ' ').trim(),
    recurrence,
    durMin: mode === 'meeting' ? durMin : null,
    remindMin,
    attendees: mode === 'meeting' ? people.slice(0, 8) : [],
  };
}

/** A note whose title the line mentions ("client call 4pm" -> "Client call: Agile Digest"), or null. */
export function noteForLine(line, notes) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const text = ` ${norm(line)} `;
  let best = null;
  let bestLen = 0;
  for (const n of notes) {
    if (!n.title || n.isDeleted || n.isArchived) continue;
    for (const key of [norm(n.title), norm(n.title.split(':')[0])]) {
      if (key.length >= 5 && text.includes(` ${key} `) && key.length > bestLen) { best = n; bestLen = key.length; }
    }
  }
  return best;
}
