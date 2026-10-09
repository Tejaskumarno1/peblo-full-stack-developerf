## What changed

<!-- One or two sentences. Link the Jira ticket (PEB-nnn). -->

## How it was tested

- [ ] `npm test` (server smoke test) and `cd client && npm test`
- [ ] `npm run build:client`, then the relevant `e2e/*.mjs` scripts

## Style parity (UI changes only)

Peblo has five styles: Studio, Console, Soft, River, Orbit. Every style must keep the core set working:
create / edit / delete a note and a task, note history, search, AI ask, quick capture.

- [ ] The change works in all five styles, or it is deliberately style-specific (say which and why)
- [ ] Shared logic lives in `hooks/`, `utils/` or `shared/`, not copied into one style or imported from another style's folder
- [ ] Anything the person chooses (style, week start, routing, ...) is saved in account settings, not only `localStorage`
- [ ] Keyboard focus is visible (the global `:focus-visible` outline is not overridden)
- [ ] `docs/memory/04-ui-styles.md` updated if the parity table changed
