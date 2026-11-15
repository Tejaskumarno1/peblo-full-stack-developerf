// Projects in a team (mockup K11): each list of the team as a card with progress, people and the next date.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FolderKanban, LayoutTemplate, ArrowRightLeft } from 'lucide-react';
import { workspacesAPI } from '../api';
import { useCurrentSpace, useSpaceName, useSpaceMembers, useSpaceRole } from './spaces';
import { Initial } from './TaskThread';
import TemplatePicker from './TemplatePicker';
import HandoverDialog from './HandoverDialog';
import './teamshare.css';

export default function TeamProjects() {
  const space = useCurrentSpace();
  const name = useSpaceName();
  const role = useSpaceRole();
  const team = useSpaceMembers();
  const navigate = useNavigate();
  const [dlg, setDlg] = useState(null);
  const [msg, setMsg] = useState('');
  const { data, refetch } = useQuery({ queryKey: ['projects', space], enabled: !!space && !!name, queryFn: () => workspacesAPI.projects(space).then((r) => r.data) });
  const projects = data?.projects || [];
  if (!name) return <p className="s-empty">Projects belong to a team. Switch to a team first.</p>;
  const nm = (id) => team.people.find((p) => p.id === id)?.name || '?';

  return (
    <div className="pj" data-testid="team-projects">
      <header className="pj-head">
        <div><h1>Projects</h1><p>{name}</p></div>
        <div className="pj-actions">
          <button type="button" className="s-share-go" data-testid="projects-template" onClick={() => setDlg('template')}><LayoutTemplate size={15} /> From a template</button>
          {role === 'lead' && <button type="button" className="s-space-ghost" data-testid="projects-handover" onClick={() => setDlg('handover')}><ArrowRightLeft size={15} /> Hand over work</button>}
        </div>
      </header>
      {msg && <p className="s-share-msg" role="status" data-testid="projects-msg">{msg}</p>}
      {data && projects.length === 0 && <p className="s-empty">No tasks yet. Start from a template to get a project going.</p>}
      <div className="pj-grid">
        {projects.map((p) => (
          <button key={p.name} type="button" className="pj-card" data-testid="project-card" onClick={() => navigate(`/tasks?list=${encodeURIComponent(p.name === 'Inbox' ? '__inbox' : p.name)}`)}>
            <span className="pj-name"><FolderKanban size={15} /> {p.name}</span>
            <span className="pj-bar" role="img" aria-label={`${p.done} of ${p.total} done`}><i style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} /></span>
            <span className="pj-meta">{p.done} of {p.total} done{p.next ? ` - next ${new Date(p.next).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}</span>
            <span className="pj-people">{p.people.slice(0, 5).map((id) => <Initial key={id} name={nm(id)} size={22} />)}</span>
          </button>
        ))}
      </div>
      {dlg === 'template' && <TemplatePicker onClose={() => setDlg(null)} onDone={(n, c) => { setMsg(`${c} tasks added to ${n}`); refetch(); }} />}
      {dlg === 'handover' && <HandoverDialog onClose={() => setDlg(null)} onDone={(c, who) => { setMsg(`${c} task${c === 1 ? '' : 's'} handed to ${who}`); refetch(); }} />}
    </div>
  );
}
