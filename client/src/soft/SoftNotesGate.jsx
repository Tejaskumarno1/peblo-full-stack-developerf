import { lazy, Suspense } from 'react';
import { useCurrentSpace, useWorkspaces } from './spaces';

const Notes = lazy(() => import('./SoftNotes'));
const OfficeFeed = lazy(() => import('./OfficeFeed'));

/** /notes: the notes page, except in an Office, where the space is an announcement feed (mockups B01 to B03). */
export default function SoftNotesGate() {
  const { data } = useWorkspaces();
  const current = useCurrentSpace();
  const here = (data?.orgs || []).flatMap((o) => o.spaces).find((s) => s.id === current);
  return <Suspense fallback={null}>{here?.kind === 'office' ? <OfficeFeed space={here} /> : <Notes />}</Suspense>;
}
