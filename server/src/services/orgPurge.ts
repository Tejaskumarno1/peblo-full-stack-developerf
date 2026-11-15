import prisma from '../db.js';

/**
 * Deleted organizations (routes/teamAdmin.ts: status 'closed', closed_at set, purge_after = 30 days later) are only soft-closed.
 * This removes the ones whose purge_after has passed. It is OFF unless PEBLO_PURGE_ORGS=1 (index.ts only schedules it then), and
 * called with dryRun it only lists what it would remove.
 *
 * What the schema does when an organization row goes (035_workspaces_expand.sql and later):
 *   ON DELETE CASCADE from organizations: org_members, spaces, org_invites, org_join_links, audit_log, org_ai_keys;
 *   from spaces: space_members, space_prefs, org_join_links. So members, invites, links and the audit trail go with it.
 *   ON DELETE RESTRICT from spaces: notes.space_id, todos.space_id, announcements.space_id. A plain DELETE of the organization
 *   therefore FAILS while any team or Office still holds a note, task or announcement. So the notes, tasks and announcements of
 *   that organization's spaces are deleted first (their own children cascade: versions, comments, links, mentions, task talk),
 *   all in one transaction per organization: either the whole organization is gone or nothing changed.
 * Personal notes (space_id NULL) are never touched. NOT RUN against a database yet (docs/SERVER-TESTS-TO-RUN.md).
 */
export const PURGE_BATCH = 5;

export async function purgeClosedOrgs(opts: { dryRun?: boolean; now?: Date } = {}): Promise<{ orgs: { id: string; name: string }[]; removed: number }> {
  const now = opts.now ?? new Date();
  const due = await prisma.$queryRaw<{ id: string; name: string }[]>`
    SELECT id, name FROM organizations
    WHERE status = 'closed' AND closed_at IS NOT NULL AND purge_after IS NOT NULL AND purge_after < ${now}
    ORDER BY purge_after LIMIT ${PURGE_BATCH}`;
  if (opts.dryRun || !due.length) return { orgs: due, removed: 0 };
  let removed = 0;
  for (const org of due) {
    try {
      await prisma.$transaction(async (tx) => {
        // re-check inside the transaction: a reopened organization (status back to 'active') must never be purged
        const still = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM organizations WHERE id = ${org.id} AND status = 'closed' AND purge_after < ${now} FOR UPDATE`;
        if (!still.length) return;
        await tx.$executeRaw`DELETE FROM announcements WHERE space_id IN (SELECT id FROM spaces WHERE org_id = ${org.id})`;
        await tx.$executeRaw`DELETE FROM todos WHERE space_id IN (SELECT id FROM spaces WHERE org_id = ${org.id})`;
        await tx.$executeRaw`DELETE FROM notes WHERE space_id IN (SELECT id FROM spaces WHERE org_id = ${org.id})`;
        await tx.$executeRaw`DELETE FROM organizations WHERE id = ${org.id}`;
        removed += 1;
      }, { timeout: 60_000 });
      console.log(`[orgs] purged closed organization ${org.id}`);
    } catch (e) {
      console.error(`[orgs] could not purge ${org.id}:`, e); // the organization stays closed; the next sweep tries again
    }
  }
  return { orgs: due, removed };
}
