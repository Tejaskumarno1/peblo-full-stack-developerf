# Security policy

## Reporting a vulnerability

Please report it privately, not in a public issue. On GitHub use **Security -> Report a vulnerability** on this repository.
Include what you found, the steps to reproduce it, and which account or data it touches.

You will get a first reply within 3 working days. Fixes for anything that exposes another person's notes, tasks or keys
are treated as urgent and shipped before other work.

## What is in scope

The hosted app, the server in `server/`, the web client in `client/`, the desktop app in `electron/`, and the MCP server.

## What we do

- Notes are encrypted at rest. AI keys are encrypted with a server secret and are never returned to the browser.
- Sharing links and AI access tokens can be revoked at any time. `#private` notes never reach an AI client.
- Dependencies are checked with `npm audit` in CI; known issues are listed in `.github/audit-allowlist.json` with a reason.