# Peblo MCP: setup, tools, versioning, upgrades

The Peblo MCP (`server/src/mcp/tools.ts`) is a thin client of the Peblo REST API. It never touches the database, so it can only do what the signed-in token can do. The full design is in `03-mcp.md`; this page is the operating manual.

## Connect

| Way | Use it for |
|---|---|
| Hosted, `https://<your-peblo>/mcp` (OAuth) | Claude apps and any client that supports remote MCP |
| stdio (`mcp/index.ts`) with `PEBLO_URL` and `PEBLO_TOKEN` | Claude Code, Desktop and other local clients |
| Shared-list MCP (`mcp/listMcp.ts`) | Read access to one shared list |

Tokens start with `pbl_`. Create them in Settings; a read-only token can search and read but never write. Name the server `peblo` in every client (a second `pebo` entry just duplicates the tool list).

## Tools

Read: `get_status`, `search_notes`, `search_all`, `get_note`, `get_backlinks`, `list_tags`, `list_tasks`, `get_calendar`, `get_image`, `list_note_history`, `list_trash`, `read_shared_link`.
Write: `create_note`, `update_note`, `append_to_note`, `trash_note`, `restore_note`, `archive_note`, `pin_note`, `rename_tag`, `create_task`, `update_task`, `complete_task`, `create_share_link`, `stop_sharing`, `restore_note_version`.

Call `get_status` first when something looks wrong: it reports the version, your time zone and today's date, whether writes are allowed and whether private notes are hidden.

## Rules the server enforces for tokens

- Notes tagged `#private` are invisible: not in search, tags, counts, backlinks or shares, and get/update/append/trash on one is refused.
- Export, backup, restore and import are refused.
- Tokens cannot read or change the profile, tokens or AI connections.
- If "Ask me before Claude adds tasks" is on, tasks created over MCP wait in the approval inbox.
- Deleting is never permanent: trash first.

## Behaviour you can rely on

- Reads retry up to 4 times on timeouts, rate limits (429) and server errors; writes are never retried.
- `create_note` and `create_task` ignore an identical repeat within 60 seconds.
- `update_note` accepts `if_updated_at` (the `updatedAt` from `get_note`); if the note changed since, nothing is written.
- `search_notes` takes `offset` and returns `nextOffset`.
- Errors come back in plain words (expired token, read-only token, not found, rate limited, server asleep).

## Versioning policy

Version lives in `MCP_VERSION` (`tools.ts`).
- Patch: bug fix, wording.
- Minor: new tool or new optional input.
- Major: a tool removed or renamed, or a new required input. Avoid; add a new tool and keep the old one.

`server/src/mcp/contract.json` records every tool and its required inputs. `e2e/mcp.mjs` fails if a tool disappears or gains a required input. Regenerate it only on purpose: `WRITE_CONTRACT=1 node e2e/mcp.mjs`.

## Upgrade checklist

1. Bump `MCP_VERSION`; add new tools as optional additions.
2. `npm run build:server`, then `node e2e/mcp.mjs` (contract, privacy, approval, retries, paging, read-only).
3. Any new endpoint a tool uses: check a token can reach it, and that `#private` notes are excluded.
4. SDK bump: `npm i @modelcontextprotocol/sdk@latest`, rebuild, rerun step 2 and the hosted `/mcp` route.
5. Commit, push to `supabase` and `main`, then call `get_status` against production.

## Known limits

- Render's free tier sleeps; the first call after idle can take about a minute (reads retry through it).
- Tokens have no expiry and no usage log yet (needs a schema change).
- Habits and settings are not reachable over MCP.
