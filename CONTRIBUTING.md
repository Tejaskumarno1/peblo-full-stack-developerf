# Contributing

1. Branch from `supabase` (the live branch). Name it `type/short-title`, or `PEB-123-short-title` when there is a Jira issue.
2. Run `npm ci` and `npm --prefix client ci`. Node 22 (see `.nvmrc`). A local Postgres is one command: `docker compose up -d`.
3. Make the change. Server code scopes every query by the signed-in user (and, once workspaces ship, by workspace).
4. Run real tests, not only a build: `npm run typecheck`, `npm test`, `npm --prefix client test`, and the end-to-end file for the area you touched (`node e2e/<name>.mjs`).
5. For any screen change: draw or update the mockup in the Soft Studio theme first, implement it exactly, and compare screenshots with the design. No emoji in the UI, icons only.
6. Update the docs in `docs/` and `CHANGELOG.md` in the same change.
7. Push the branch, open a pull request using the template, and wait for "Type-check, build and test" to pass.