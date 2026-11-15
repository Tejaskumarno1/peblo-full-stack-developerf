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

## Branch `feat-versions` (version history for team notes, light notes list, cheaper search)

Code compiles (`npm run build:server`, client `vite build`) and the browser checks in `e2e/notes-mock.mjs` pass against a FAKE API. The server code has never run. Use a local Postgres (never `server/.env`). `scripts/smoke-test.mjs` has a new block at the end of the main `try` (light list, search) that has not been run.

1. **Versions in a team space.** Team with A (author), B (member), C (viewer), D (not a member). Note N in the team, with a few edits by A. `GET /notes/N/backups` with `x-peblo-space`: A, B and C get 200 with versions; D gets 404. Without the header (Personal scope) B gets 404 for N.
2. **Restore and name.** `POST /notes/N/backups/:id/revert`, `POST /notes/N/versions {label}` and `PATCH /notes/N/backups/:id`: B (member) succeeds; C (viewer) gets 403 "You can read this space but not change it". Share N with the team as "can view" (`meta.teamShare.level='view'`): B gets 403 code `view_only`, A still succeeds. After a restore the live room reloads; `saved_by` is kept.
3. **Office rules.** In an Office, a private note of A: B gets 403 `no_access` on all five routes; shared "view": GET works, revert/name/rename give 403 `view_only`; shared "edit": all work.
4. **Personal unchanged.** Own note: all five routes behave as before; another user's note id gives 404.
5. **`GET /notes?fields=list`.** Rows have `snippet` (at most 140 chars), `wordCount`, `hasPics`, `taskCount`, `tags`, `meta`, owner/access info (Office) and no `content`, `aiGenerations` or `_count`. Without `fields` the shape is unchanged (Orbit, River, Home). Works with `archived`, `deleted`, `tag`, `sort`, `limit`/`offset`.
6. **Search.** `search=a` returns `[]`. A title match and a tag match are found; a body-only match is still found; more than 200 matches return 200; `limit/offset` pages the result; `#private` notes stay hidden from an access token; the fuzzy title branch still adds near-misses. Time it with 3000+ notes before and after.
7. **Client with the real server.** Open Soft Notes: the sidebar and list need one light request each; opening a note loads the text from `GET /notes/:id`; typing causes no library refetch; an edit on a second device shows up on the first within about 5 s. Gallery loads the full list only when opened. "Mentioned in" comes from `/notes/:id/mentions` (it matches the saved title).
## Live team rooms (branch feat-realtime, R11): compiled only, never run

Test cases were added to `scripts/smoke-test.mjs` (block "added UNRUN, R11") and have not been executed. Run them against a local `peblo_test` database, plus by hand:

1. **Join on connect.** User A leads a team, B is a member. B opens a socket: B's socket is in `space:<id>` (check with `io.in('space:<id>').fetchSockets()` or by A's note create reaching B).
2. **Team events.** A creates, updates, trashes, restores, archives, moves and shares a team note, and creates, updates, deletes and bulk-edits a team task (with `x-peblo-space`): B receives `notes_changed` / `todos_changed` with `{ space }`. The payload holds no text. A's own windows receive it once (not twice).
3. **Personal stays private.** A Personal note or task of A: B receives nothing. Moving a note Personal to team and team to Personal: the source and destination windows both refresh.
4. **Removal.** B leaves a team (`POST /spaces/:id/leave`), is removed from the org (`DELETE /orgs/:id/members/:userId`), is paused (`PATCH ... {status:'paused'}`), or the team is closed: B's open socket stops receiving that space's events at once; a new socket does not join the room.
5. **Joining.** B accepts an invite or join link, or is added by `PUT /spaces/:id/members/:userId`: B's already-open socket starts receiving without reconnecting.
6. **Safety net.** Guest expiry (`guest_until` in the past) drops the room within 5 minutes (`startRoomRefresh`).
7. **Spoofed header.** A request with an `x-peblo-space` of a space the caller is not in answers 404 from `noteScope` and emits nothing (`req.peerSpace` is only set after the access check).

