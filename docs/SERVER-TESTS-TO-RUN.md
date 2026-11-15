# Server changes that still need a database test

Commits `94ced39` and `c3f01da` (team authorization fixes) compile (`npm run build:server`) but have **never been run against a database**. Run these against a **local** Postgres named `peblo_test` (never `server/.env`, which points at production). `scripts/smoke-test.mjs` has one new check (sole-owner account deletion) that has not been run either.

1. **Sole owner cannot delete the account.** Create a user, make an organization, call `POST /auth/delete-account` and `/auth/schedule-deletion`: expect 409. Add a second active owner: expect 200. Set `deletion_requested_at` to 31 days ago for a sole owner and run `purgeScheduledDeletions`: the user must survive.
2. **Team note manage rights.** Team with A (author), B (member), C (lead). B gets 403 `owner_only` on DELETE, restore, archive, move, `PATCH {isArchived}` and `?permanent=1`. A and C succeed. Personal and Office behaviour is unchanged. Check the client toast text for `owner_only` and `no_access`.
3. **Join link.** `lookup` returns `ready`. Accept with `max_uses=1` from two concurrent requests: exactly one succeeds. Make `space_members` fail: `uses` is not burned. Set the org to `read_only`: `revoked`.
4. **Invite accept.** Accept twice at once: one 200, one 409 `state:'used'`. Revoke then accept: 409. Put a closed space and another org's space in `space_ids`: no `space_members` rows for them.
5. **`PUT /spaces/:id/members/:userId`.** Demote the only lead: 409. Make an org guest a lead: 400. Demote one of two leads: 200.
6. **Guest `GET /orgs/:id/members`.** Only name, avatar, role and status; only people sharing a space with the guest plus the guest; `invites` is `[]`. A non-guest gets the full list. Confirm the client does not break on missing `email` and `spaces`.
7. **Live edit after removal.** Remove a member who authored a team note: `/collab/ticket` returns 404 and the open socket closes. An author who is still a member keeps live edit in Team, Office and Personal.
8. **`spaceMembers()`.** Assign a task to an expired guest, a paused member and a member of a closed org: expect the "not in this space" 400.

Known gaps left on purpose: an invite to a `read_only` org still reads as `ready`; the guest member list does not exclude people who share only a closed space; check that a last owner can actually leave (the deletion message tells them to).
