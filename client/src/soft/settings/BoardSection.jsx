// Settings: the columns of the Kanban board for the space you are in (a team's shared board, or Personal).
import { useEffect, useState } from 'react';
import { ArrowUp, ArrowDown, Trash2, Plus } from 'lucide-react';
import { Card } from './ui';
import { useBoardColumns, TONES } from '../useBoard';
import { useSpaceName } from '../spaces';

const keyFor = (name, taken) => {
  const base = `c_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20) || 'col'}`;
  let k = base; let i = 2;
  while (taken.includes(k)) k = `${base}_${i++}`;
  return k;
};

export default function BoardSection() {
  const { columns, canEdit, save, loading } = useBoardColumns();
  const scope = useSpaceName();
  const [list, setList] = useState(columns);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setList(columns); }, [columns]);
  const dirty = JSON.stringify(list) !== JSON.stringify(columns);
  const mid = list.slice(1, -1);
  const setMid = (m) => setList([list[0], ...m, list[list.length - 1]]);
  const edit = (i, patch) => setList(list.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const add = () => {
    const n = name.trim();
    if (!n || list.length >= 12) return;
    setMid([...mid, { key: keyFor(n, list.map((c) => c.key)), name: n, tone: TONES[(mid.length + 1) % TONES.length] }]);
    setName('');
  };
  const swap = (i, d) => { const m = [...mid]; const j = i + d; if (j < 0 || j >= m.length) return; [m[i], m[j]] = [m[j], m[i]]; setMid(m); };
  const commit = async () => {
    setBusy(true); setMsg('');
    try { await save(list); setMsg('Board saved.'); } catch (e) { setMsg(e.response?.data?.error || 'Could not save the board.'); }
    setBusy(false);
  };

  return (
    <Card title="Board columns" hint={scope ? `The Kanban board of ${scope}. Everyone in the team sees these columns.` : 'Your own Kanban board. Teams keep their own columns.'}>
      <div className="bs" data-testid="board-settings">
        {!canEdit && <p className="bs-note">Only a team lead can change these columns.</p>}
        <ol className="bs-list">
          {list.map((c, i) => {
            const fixed = i === 0 || i === list.length - 1;
            return (
              <li key={c.key} className="bs-row" data-testid="board-col">
                <span className={`bs-dot tone-${c.tone}`} aria-hidden="true" />
                <input aria-label={`Column name ${i + 1}`} value={c.name} maxLength={30} disabled={!canEdit} onChange={(e) => edit(i, { name: e.target.value })} />
                {fixed ? <small>{i === 0 ? 'First column' : 'Finished tasks'}</small> : (
                  <span className="bs-act">
                    <select aria-label={`Colour of ${c.name}`} value={c.tone} disabled={!canEdit} onChange={(e) => edit(i, { tone: e.target.value })}>{TONES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                    <button type="button" aria-label={`Move ${c.name} left`} disabled={!canEdit || i === 1} onClick={() => swap(i - 1, -1)}><ArrowUp size={14} /></button>
                    <button type="button" aria-label={`Move ${c.name} right`} disabled={!canEdit || i === list.length - 2} onClick={() => swap(i - 1, 1)}><ArrowDown size={14} /></button>
                    <button type="button" aria-label={`Remove ${c.name}`} disabled={!canEdit} onClick={() => setMid(mid.filter((x) => x.key !== c.key))}><Trash2 size={14} /></button>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        {canEdit && (
          <div className="bs-add">
            <input aria-label="New column name" placeholder="Add a column, for example Interview done" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
            <button type="button" className="bs-btn" data-testid="board-add" disabled={!name.trim() || list.length >= 12} onClick={add}><Plus size={14} /> Add column</button>
          </div>
        )}
        {canEdit && (
          <div className="bs-save">
            <button type="button" className="bs-btn primary" data-testid="board-save" disabled={!dirty || busy || loading} onClick={commit}>Save board</button>
            {dirty && <button type="button" className="bs-btn" onClick={() => setList(columns)}>Reset</button>}
            {msg && <span role="status" data-testid="board-msg">{msg}</span>}
          </div>
        )}
        <p className="bs-note">Removing a column sends its tasks back to the first column. Columns with nothing in them fold into a thin strip on the board; click a strip to open it.</p>
      </div>
    </Card>
  );
}
