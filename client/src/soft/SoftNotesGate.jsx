import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCurrentSpace, useWorkspaces } from './spaces';

const Notes = lazy(() => import('./SoftNotes'));
const OfficeFeed = lazy(() => import('./OfficeFeed'));

/** /notes: the notes page, except in an Office, where ?view=announcements shows the announcement feed (mockups B01 to B03, E02) and the rest is notes. */
export default function SoftNotesGate() {
  const { data } = useWorkspaces();
  const current = useCurrentSpace();
  const [params] = useSearchParams();
  const here = (data?.orgs || []).flatMap((o) => o.spaces).find((s) => s.id === current);
  return <Suspense fallback={null}>{here?.kind === 'office' && params.get('view') === 'announcements' ? <OfficeFeed space={here} /> : <Notes />}</Suspense>;
}
