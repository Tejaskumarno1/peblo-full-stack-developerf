import { useState } from 'react';
import { Building2, Users } from 'lucide-react';
import { Card } from './ui';
import { useWorkspaces, CreateOrgDialog } from '../spaces';

/** Settings > Organizations (mockup C16): the organizations a person belongs to, and a way to set one up. */
export function OrganizationsSection() {
  const { data, isLoading } = useWorkspaces();
  const [creating, setCreating] = useState(false);
  const orgs = data?.orgs || [];
  return (
    <>
      <Card title="Organizations you belong to" hint="Personal always stays yours. Nobody in an organization can read it."
        aside={<button type="button" className="s-share-go" data-testid="org-create" onClick={() => setCreating(true)}>Set up an organization</button>}>
        <div className="s-org-list" data-testid="org-list">
          {isLoading && <p className="s-share-msg">Loading...</p>}
          {!isLoading && orgs.length === 0 && <p className="s-share-msg">You are not in an organization yet. Set one up to share notes and tasks with a team.</p>}
          {orgs.map((o) => (
            <div key={o.id} className="s-org-row" data-testid="org-row">
              <i><Building2 size={20} /></i>
              <div><b>{o.name}</b><small>{o.spaces.length === 0 ? 'No spaces yet' : `${o.spaces.length} space${o.spaces.length === 1 ? '' : 's'}: ${o.spaces.map((s) => s.name).join(', ')}`}</small></div>
              <span className="s-chip-tag" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 800 }}><Users size={14} /> {o.role[0].toUpperCase() + o.role.slice(1)}</span>
            </div>
          ))}
        </div>
      </Card>
      {creating && <CreateOrgDialog onClose={() => setCreating(false)} />}
    </>
  );
}
