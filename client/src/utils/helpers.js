// Tag hash to color family mapping
const tagColors = ['tag-blue', 'tag-teal', 'tag-amber', 'tag-purple', 'tag-coral'];

export function stringToColorClass(str) {
  if (!str) return 'tag-default';
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % tagColors.length;
  return tagColors[index];
}

// Strip markdown symbols for preview text
export function stripMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, ' ') // Drop table divider rows like |---|---|
    .replace(/\|/g, ' ') // Drop table cell pipes
    .replace(/[#*_~`>]/g, '') // Remove simple markdown chars
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Remove links but keep text
    .replace(/\s+/g, ' ') // Collapse newlines and runs of spaces
    .trim();
}

// Relative date formatting, by calendar day (not by 24-hour blocks), for past and future dates
export function formatRelativeDate(dateString, now = new Date()) {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((dayStart(now) - dayStart(date)) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays === -1) return 'Tomorrow';
  if (diffDays > 1 && diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < -1 && diffDays > -7) return `In ${-diffDays} days`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
