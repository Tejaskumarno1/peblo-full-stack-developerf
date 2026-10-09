// The server lists saved keys it cannot read (saved by another Peblo install) in settings.unreadableKeys.
const NAMES = { openAiKey: 'OpenAI', geminiKey: 'Gemini' };

export function unreadableKeyMessage(settings) {
  const bad = (settings?.unreadableKeys || []).map((k) => NAMES[k]).filter(Boolean);
  if (!bad.length) return '';
  return `Your saved ${bad.join(' and ')} key can't be read on this computer (it was saved by a different Peblo install). Please enter it again below.`;
}
