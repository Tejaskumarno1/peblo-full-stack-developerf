# Peblo project memory

This folder is the **single source of truth about how Peblo actually works**. It was written by reading every source file, not from plans, so it reflects the code at the commit noted in each file.

It is written for:
- new developers, designers, testers and AI assistants (Claude, Copilot), so they don't have to rediscover the app;
- anyone picking up a Jira ticket: each ticket from the analysis names its memory ID (e.g. `S-02`).

## Files

| File | Read it when you need… |
|---|---|
| [01-overview.md](01-overview.md) | what Peblo is, the architecture, the code map, how to run it |
| [02-server.md](02-server.md) | any API endpoint, auth, rate limits, encryption, notes/tasks logic, AI prompts and routing, retrieval |
| [03-client.md](03-client.md) | app start-up, the API layer, auth in the client, browser storage keys, each screen, shortcuts |
| [04-ui-styles.md](04-ui-styles.md) | Soft Studio, River and Orbit, the study and River APIs, the feature × style table |
| [05-platform.md](05-platform.md) | Electron, build and installers, CI, every env var, every database table, scripts, docs and gap list, challenge checklist |
| [06-issues.md](06-issues.md) | every known problem with its Jira key, and the suggested order |
| [07-history-and-decisions.md](07-history-and-decisions.md) | how the app evolved, decisions made, decisions still open |
| [08-verification.md](08-verification.md) | which issues were **proved by running the code**, how, and what is still untested |
| [09-ui-runtime.md](09-ui-runtime.md) | browser test of the real build: every screen in every style, bug reproductions, accessibility numbers |
| [10-coverage-review.md](10-coverage-review.md) | what the first pass missed: file coverage matrix, CSS/themes/tokens, git branches and history, licences, requirement-by-requirement status vs Jira |

Line numbers in 02–05 are approximate (`~`) and drift as code changes; search for the function name.

## Keeping it true (the rules)

1. **Change the code → change the memory in the same pull request.** A new endpoint goes into `02-server.md` §2; a new env var into `05-platform.md` §3; a new table into `05-platform.md` §4; a new storage key into `03-client.md` §4.4.
2. **Fix an issue → update its row in `06-issues.md`** (status + commit) and move the Jira ticket.
3. **Find a problem → add a row** with the next free ID, and create a Jira ticket that names the ID.
4. **Decide something → add it to `07-history-and-decisions.md`.**
5. Never paste secrets, real passwords or personal data here.
6. Keep `CLAUDE.md` (repo root) short: it is the index that AI assistants load first.
