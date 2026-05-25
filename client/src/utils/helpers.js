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
    .replace(/[#*_~`>]/g, '') // Remove simple markdown chars
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Remove links but keep text
    .replace(/\n+/g, ' ') // Replace newlines with spaces
    .trim();
}

// Relative date formatting
export function formatRelativeDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  
  const diffTime = Math.abs(now - date);
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    // Check if it's actually today vs yesterday (based on calendar day, not just 24h)
    if (now.getDate() === date.getDate()) return 'Today';
    return 'Yesterday';
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}
