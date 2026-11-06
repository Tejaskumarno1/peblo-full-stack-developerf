/** A small coloured tile per AI company, so each connection is spotted at a glance. Letters and colours of our own, not the companies' logos. */
const LOOK = {
  anthropic: ['C', '#F4C7B0', '#5A2410'],
  openai: ['O', '#CFE6D8', '#17402B'],
  gemini: ['G', '#CBDDF5', '#16325C'],
  groq: ['Gq', '#F8D7A6', '#5A3A0A'],
  openrouter: ['Or', '#DCD0F0', '#3A2A63'],
  deepseek: ['D', '#C8E3EC', '#133F4F'],
  mistral: ['M', '#F6DDB0', '#5C3C08'],
  together: ['T', '#D5E5C4', '#2F4A14'],
  xai: ['X', '#E2DDD3', '#2B2620'],
  custom: ['+', '#E6E0D4', '#2B2620'],
};
export default function ProviderBadge({ id, size = 30 }) {
  const [t, bg, fg] = LOOK[id] || LOOK.custom;
  return (
    <span aria-hidden="true" style={{ width: size, height: size, borderRadius: '50%', background: bg, color: fg, display: 'inline-grid', placeItems: 'center', flex: 'none', fontWeight: 800, fontSize: t.length > 1 ? size * 0.4 : size * 0.48, letterSpacing: '-0.02em' }}>{t}</span>
  );
}
