import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';

// The keyboard shortcuts list (mockup B2): searchable, grouped, every key on its own chip.
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(`${navigator.userAgentData?.platform || ''} ${navigator.userAgent || ''}`) ? 'Cmd' : 'Ctrl';
const GROUPS = [
  { group: 'Edit', rows: [['Undo', [MOD, 'Z']], ['Redo', [MOD, 'Y']], ['Redo', [MOD, 'Shift', 'Z']], ['Paste plain', [MOD, 'Shift', 'V']]] },
  { group: 'Text', rows: [['Bold', [MOD, 'B']], ['Italic', [MOD, 'I']], ['Underline', [MOD, 'U']], ['Strike', [MOD, 'Shift', 'S']], ['Link', [MOD, 'K']]] },
  { group: 'Blocks', rows: [['Indent', ['Tab']], ['Outdent', ['Shift', 'Tab']], ['Soft line break', ['Shift', 'Enter']], ['Move block', ['Alt', 'Up']], ['Move block down', ['Alt', 'Down']]] },
  { group: 'Find and move', rows: [['Find', [MOD, 'F']], ['Replace', [MOD, 'H']], ['Back', ['Alt', 'Left']], ['Forward', ['Alt', 'Right']], ['Next tab', ['Ctrl', 'Tab']], ['Reopen closed tab', [MOD, 'Shift', 'T']]] },
  { group: 'Everywhere', rows: [['Command palette', [MOD, 'K']], ['Quick capture (desktop)', [MOD, 'Shift', 'Space']], ['Open the AI Hub', [MOD, 'J']], ['Show help', ['?']]] },
  { group: 'Notes', rows: [['New note', [MOD, 'N']], ['Save now', [MOD, 'S']], ['Search notes', [MOD, '/']]] },
  { group: 'Quick capture', rows: [['Switch note and task', ['Tab']], ['Close', ['Esc']]] },
];

export default function KeyboardShortcuts() {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return GROUPS.map((g) => ({ ...g, rows: g.rows.filter(([name, keys]) => !t || `${name} ${keys.join(' ')} ${g.group}`.toLowerCase().includes(t)) })).filter((g) => g.rows.length);
  }, [q]);
  return (
    <section className="s-keys" aria-label="Keyboard shortcuts">
      <div className="s-keys-head">
        <h3>Keyboard shortcuts</h3>
        <label className="s-keys-search"><Search size={15} /><input type="search" aria-label="Search shortcuts" placeholder="Search shortcuts" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      <div className="s-keys-grid">
        {shown.map((g) => (
          <div key={g.group} className="s-keys-group" data-testid="keys-group">
            <div className="s-keys-title">{g.group}</div>
            {g.rows.map(([name, keys]) => (
              <div key={name + keys.join()} className="s-keys-row"><span>{name}</span>{keys.map((k) => <kbd key={k} className="s-kbd">{k}</kbd>)}</div>
            ))}
          </div>
        ))}
        {!shown.length && <p className="s-keys-none">No shortcut matches "{q}".</p>}
      </div>
    </section>
  );
}
