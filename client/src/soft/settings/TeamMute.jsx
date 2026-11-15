import { useWorkspaces } from '../spaces';
import { useSpaceMuted } from '../spacePrefs';
import { Card, Row, Switch } from './ui';

function TeamRow({ space }) {
  const { muted, loading, setMuted } = useSpaceMuted(space.id);
  return (
    <Row label={space.name} hint={muted ? 'Muted: nothing from this team except @mentions of you and tasks given to you.' : 'You hear from this team.'}>
      <Switch label={`Notifications from ${space.name}`} checked={!muted} onChange={(v) => { if (!loading) void setMuted(!v).catch(() => {}); }} />
    </Row>
  );
}

/** Settings > Notifications: mute a whole team. A muted team sends no stored notifications and no pop-ups; direct @mentions and tasks assigned to you still arrive. */
export default function TeamMuteCard() {
  const { data } = useWorkspaces();
  const spaces = (data?.orgs || []).flatMap((o) => o.spaces);
  if (!spaces.length) return null;
  return (
    <Card title="Teams" hint="Turn a team off to mute it. Muting is kept on the server, so it also stops the notification list, not only pop-ups.">
      <div data-testid="team-mute">{spaces.map((sp) => <TeamRow key={sp.id} space={sp} />)}</div>
    </Card>
  );
}
