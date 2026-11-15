/**
 * A small round mark per AI company or app, so each one is spotted at a glance.
 * If an official logo file named after the id sits in client/src/assets/brands (claude.svg, cursor.png ...), it is used.
 * Otherwise a tile with our own letters and colours is drawn. We do not draw other companies' logos ourselves.
 */
const FILES = import.meta.glob('../../assets/brands/*.{svg,png}', { eager: true, query: '?url', import: 'default' });
const logoFor = (id) => {
  const hit = Object.keys(FILES).find((p) => new RegExp(`/${id}\\.(svg|png)$`).test(p));
  return hit ? FILES[hit] : null;
};
const LOOK = {
  anthropic: ['C', '#F4C7B0', '#5A2410'],
  claude: ['C', '#F4C7B0', '#5A2410'],
  openai: ['O', '#CFE6D8', '#17402B'],
  chatgpt: ['Ch', '#CFE6D8', '#17402B'],
  gemini: ['G', '#CBDDF5', '#16325C'],
  groq: ['Gq', '#F8D7A6', '#5A3A0A'],
  openrouter: ['Or', '#DCD0F0', '#3A2A63'],
  deepseek: ['D', '#C8E3EC', '#133F4F'],
  mistral: ['M', '#F6DDB0', '#5C3C08'],
  together: ['T', '#D5E5C4', '#2F4A14'],
  xai: ['X', '#E2DDD3', '#2B2620'],
  cursor: ['Cu', '#DCD0F0', '#3A2A63'],
  vscode: ['VS', '#CBDDF5', '#16325C'],
  custom: ['+', '#E6E0D4', '#2B2620'],
};
export default function ProviderBadge({ id, size = 30 }) {
  const logo = logoFor(id);
  if (logo) return <img src={logo} alt="" aria-hidden="true" width={size} height={size} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'contain', flex: 'none' }} />;
  const [t, bg, fg] = LOOK[id] || LOOK.custom;
  return (
    <span aria-hidden="true" style={{ width: size, height: size, borderRadius: '50%', background: bg, color: fg, display: 'inline-grid', placeItems: 'center', flex: 'none', fontWeight: 800, fontSize: t.length > 1 ? size * 0.4 : size * 0.48, letterSpacing: '-0.02em' }}>{t}</span>
  );
}
