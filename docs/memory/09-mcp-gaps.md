# MCP gaps: what the app can do that the Peblo MCP server cannot (checked against MCP 1.3.0, 2026-11-24)

The MCP (`server/src/mcp/tools.ts`) offers 27 tools: status, search, notes (read, create, append, update, archive, pin, trash, restore, history), tasks (list, create, update, complete), calendar, share links, tags, spaces, images.
The app's REST API has about 250 endpoints. The 50 gaps below are things the app does that an AI client cannot do or see. Rule for all of them: **additive only, nothing is deleted** (no delete task, no empty trash, no delete tag, no remove member).
Tokens read a team but write only in Personal (`utils/scope.ts`); team writes stay a server-side decision, not an MCP one.

Status key: **done** = shipped in MCP 1.4.0 (this change), **todo** = not yet.

## Tasks and Kanban
1. Create a task with Kanban column/status, assignees, steps, link, estimate, visibility. `create_task` has none of them. (todo)
2. Update a task's column/status, steps, link, estimate, assignees. `update_task` cannot. (todo)
3. Read every task on a board, dated or not, by column. (**done**: `list_tasks` all=true, space)
4. Read the board's columns (names, order). (**done**: `list_board_columns`)
5. Read a task's discussion thread. (**done**: `get_task_thread`)
6. Post a comment on a task (with @mentions). (todo)
7. Ask for a review of a task. (todo)
8. Bulk-update tasks (move many cards, retag many). (todo)
9. Read "my day" across all teams. (**done**: `get_my_day`)
10. Read the team calendar range. (**done**: `get_team_calendar`)
11. Read team workload. (**done**: `get_team_workload`)
12. Read team projects. (**done**: `list_team_projects`)
13. List task templates. (**done**: `list_task_templates`)
14. Save a task as a template. (todo)
15. Rename a tag on team tasks (rename only touches your own tasks). (todo)

## Notes
16. Create today's daily note (`POST /notes/daily`). (todo)
17. Read what a note mentions / is mentioned by. (**done**: `get_note_mentions`)
18. Link two notes from a mention. (todo)
19. Copy a note. (todo)
20. Move a note to a folder or space. (todo)
21. See and change who can see/edit a note (access list). (todo)
22. Share a note with a team (team-share). (todo)
23. Read the content of one old version (history lists them, cannot open one). (**done**: `get_note_version`)
24. Save a named version now. (todo)
25. Bulk note actions (tag, move, archive many). (todo)
26. Rename a folder. (todo)
27. Read trash info (counts, size). (**done**: `get_trash_info`)
28. `create_note` / `update_note` cannot set folder, pinned or space. (todo)
29. Read and post note comments (`/collab/comments`). Read: (**done**: `list_note_comments`). Post: (todo)
30. Read notifications. (**done**: `list_notifications`) Mark as read: (todo)

## AI features of the app
31. Summarise a note with Peblo's own AI (`/:id/ai/summary`). (todo)
32. Pull action items out of a note (`/:id/ai/actions`). (todo)
33. Suggest a title / tags for a note. (todo)
34. Break a task into steps (`/ai/task-steps`). (todo)
35. Ask your notes (grounded chat, `/ai/chat`, AI Hub search). The docs list `ask_notes`, `list_recent_notes` and `get_agenda`, but they are not registered. (todo)
36. Smart intake: turn pasted text or a file into tasks and notes. (todo)
37. Transcribe audio. (todo)
38. Link preview. (todo)

## Study, River, Dashboard
39. Read study mastery. (**done**: `get_study_mastery`)
40. Read study activity. (**done**: `get_study_activity`)
41. Generate a quiz from a note and submit answers. (todo)
42. Read the questions of a note. (todo)
43. List River promises. (**done**: `list_promises`) Mark one kept/done: (todo)
44. Read daily briefing, weekly report and insights. (**done**: `get_daily_briefing`, `get_weekly_report`, `get_insights`)

## Calendar, files, lists
45. List calendar feeds and read their events. (**done**: `list_calendar_feeds`, `get_calendar_events`)
46. Search media and read a file's text. (**done**: `search_media`, `get_media_text`)
47. See shared task lists (`/task-lists/shares`) and their comments. (todo)

## Teams and people
48. Read the team feed and announcements. (**done**: `get_team_feed`, `list_announcements`) Post an announcement: (todo)
49. List people in a team (so "assign to Ana" works). (**done**: `list_people`)
50. Read the profile; plus MCP resources and prompts (the docs promise them, none are registered). Profile: (**done**: `get_profile`) Resources/prompts: (todo)

## Not planned (destructive, so excluded on purpose)
Delete task, delete tag, empty trash, remove member or invite, delete organisation, restore a backup over the account, change AI keys, change policy.

## Update: Kanban and task tools (MCP 1.4.0, items 1 to 20)
Added in `server/src/mcp/taskTools.ts` and by extending `create_task` / `update_task` (column, assignees, visibility, viewers, link, estimate, details, repeat-from-done, steps, watch, space):
`add_task_comment`, `request_task_review`, `bulk_update_tasks`, `set_board_columns`, `duplicate_task`, `add_task_steps`, `set_task_step_done`, `find_similar_tasks`, `quick_add_task`, `create_task_from_note`, `list_task_proposals`.

**What stays out on purpose**
- Approving or declining a proposed task: only the person can, otherwise an AI client could approve its own proposals. `list_task_proposals` is read only.
- Skip one occurrence of a repeating task, delete, hand over a leaver's tasks, set availability: deletes or admin writes.

**Token limits that apply (server, not MCP)**
- A token changes only Personal tasks (`utils/scope.ts`). `create_task`, `update_task`, `bulk_update_tasks`, `set_board_columns` on a team board answer "not found". Comments and review requests on a team task do work (the server checks team membership).
- `/api/profile`, `/api/calendar-sync` and `/api/workspaces/orgs/*` stay sign-in only. So `get_profile`, `list_calendar_feeds` and `get_calendar_events` were removed again (they could only return 403).
- Narrow read-only allowlist added in `middleware/auth.ts` for the team views: `my-day`, `team-range`, `:space/(workload|projects|templates|feed)`, `spaces/:id/(announcements|people-lite)`. Before it, the 8 team tools added earlier could only return 403.
- `GET /api/whoami` now also returns the person's own `id` (needed for `watch`).

## Update: reliability pass (MCP 1.4.0, same version, more tools)
- **Time zone (real bug):** the server reads the zone from the `X-Timezone` header, which only the browser sends. Every MCP date ("today", overdue, the calendar) used the server's UTC clock. The MCP now sends the person's profile zone, or `tz` when given, on `list_tasks`, `get_calendar`, `get_agenda` and `quick_add_task`. `get_status` warns when the profile zone is the UTC default.
- **One task by id:** `GET /api/todos/one/:id` and the `get_task` tool. `update_task`, `add_task_steps`, `set_task_step_done` and `duplicate_task` no longer download up to 2000 tasks to find one.
- **New read tools:** `get_task`, `list_recent_notes`, `get_agenda`. **Prompts:** `plan_my_day`, `weekly_review`.
- **Sharing:** `shareableTodo` also requires the task to be visible to the person (a task for "just me" or picked people cannot be made public by a teammate who cannot see it).
- **CI:** every run since 22 Nov failed at `npm --prefix client ci` (onnxruntime-node tried to download a CUDA build that 404s on GitHub runners). Now installs with `--onnxruntime-node-install-cuda=skip`.
- **Tests:** `server/src/mcp/parseTask.test.mjs` (10 cases, runs with plain `node`); 22 new cases in `e2e/mcp.mjs` for the 1.4.0 task tools. The e2e cases need the app and a database, so they run in CI, not locally.
- **Share dialog:** restyled to the redesign (board 22) in `client/src/soft/shareRedesign.css`.
- The MCP endpoint is stateless (a new server per request), so "tools changed" notifications cannot be pushed. A client that cached the tool list keeps it until it reconnects. `get_status` reports the version so a stale list is easy to spot.

## Not done, and why
- Paid Render plan or a keep-alive pinger: costs money / standing automation, needs your yes.
- Token scopes per team, token expiry, idempotency keys, undo: each needs a database migration that runs on production at boot.
- Dependabot majors (Express 5.3, TypeScript 7): breaking upgrades, one at a time.
- Team-board writes with a token, approving proposals over MCP: deliberately blocked.
- Setting the profile time zone: tokens cannot change account settings, so do it in the app.
