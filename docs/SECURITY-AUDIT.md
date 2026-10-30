# Dependency audit notes

CI runs `node scripts/audit-gate.mjs` (weekly, on pushes and on pull requests). It audits shipped dependencies (`--omit=dev`) for the root (server and desktop shell) and `client/`. It fails on any high or critical advisory that is not listed in `.github/audit-allowlist.json`, and on any list entry past its expiry date. Moderate and low advisories are printed only.

To accept an advisory: check whether Peblo reaches the vulnerable code, add a mitigation if it does, then add an entry with the advisory link, the reason and a short expiry.

## Accepted: xlsx 0.18.5 (client, direct)

- [GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6) prototype pollution, [GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9) ReDoS. The npm package is frozen at 0.18.5; fixed versions (0.20.x) are published only on cdn.sheetjs.com.
- Reachable: yes, in the browser only. A spreadsheet in a note (possibly from a shared note) is previewed through `client/src/utils/sheetRead.js`. The server stores files and never parses them.
- Mitigation: 10 MB cap, 2000 rows, 50 sheets and 40 columns per read, a prototype check after each read, and the read runs in a Web Worker stopped after 20 s.
- Exit plan: move to the SheetJS 0.20.x tarball (see the package notes below), then remove the allowlist entries.

## Not reachable or dev-only

- `image-size` (high, via `pptxgenjs`): dev dependency used only by `e2e/fixtures/make.mjs`. Not shipped, excluded by `--omit=dev`.
- `vite` (moderate): dev server only.
- `pptx-preview` -> `echarts` (XSS), `uuid` (buffer bounds): moderate; see the audit report for the upgrade path.
