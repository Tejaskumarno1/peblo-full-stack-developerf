# Dependency audit notes

CI runs `node scripts/audit-gate.mjs` (weekly, on pushes and on pull requests). It audits shipped dependencies (`--omit=dev`) for the root (server and desktop shell) and `client/`. It fails on any high or critical advisory that is not listed in `.github/audit-allowlist.json`, and on any list entry past its expiry date. Moderate and low advisories are printed only.

To accept an advisory: check whether Peblo reaches the vulnerable code, add a mitigation if it does, then add an entry with the advisory link, the reason and a short expiry.

## Resolved: xlsx

- The client uses the SheetJS 0.20.3 tarball from cdn.sheetjs.com, which fixes GHSA-4r6h-8v6p-xvw6 and GHSA-5pgg-2g8v-p4x9. The npm registry copy is frozen at 0.18.5. The allowlist is empty. Reads still go through `client/src/utils/sheetRead.js` (size, row and sheet caps, Web Worker with a 20 s limit).

## Not reachable or dev-only

- `image-size` (high, via `pptxgenjs`): dev dependency used only by `e2e/fixtures/make.mjs`. Not shipped, excluded by `--omit=dev`.
- `vite` (moderate): dev server only.
- `pptx-preview` -> `echarts` (XSS), `uuid` (buffer bounds): moderate; see the audit report for the upgrade path.
