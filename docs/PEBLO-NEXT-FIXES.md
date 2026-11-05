# Peblo: everything, end to end (updated 5 Nov 2026)

## 0. Where things stand
- Code: GitHub Tejaskumarno1/peblo-full-stack-developerf, branches `supabase` and `main` both at commit 1cb9aea. Render auto-deploys `supabase` to https://peblo-stxo.onrender.com.
- Everything for Peblo now lives on D:\Peblo. Old C: copies are parked in D:\Peblo\_old-C-originals; delete when you are happy.
- Windows SmartScreen blocks the unsigned installer: click "More info", then "Run anyway".

## 1. Done and pushed
| Item | Commit |
|---|---|
| Row colour popup, own cursor hidden, table "Open in new tab", huge avatar | 8f26746 |
| Outline no longer overlaps notes in full screen (wide screens get side padding, drawer aware) | d401c0f |
| "?" glyphs: every broken character in SoftNotes repaired; new guard `node scripts/find-glyphs.mjs --check` | d401c0f |
| Folder sheet: Create and Cancel buttons pinned and visible | d401c0f |
| Copy pictures: read-only share pages open a full-size view with Copy picture and Save; editor picture toolbar and lightbox have Copy | 1cb9aea |

## 2. Waiting for your approval (mockups on the design canvas, nothing built yet)
1. Editor toolbar block menu: grouped icon grid (Text, Lists, Blocks), type to filter, direct Check list and Bullets on the bar, More for H4 to H6 and toggle headings.
2. Peblo right-click menu: different menus for notes, tabs, links in a note and empty space. Open, Open in new tab, split view, new window, Open as (incognito, reader, public page), Create (note, folder, to-do), Move to folder, Tag, Pin, Duplicate, Copy link, temporary link with pictures, Save as (PDF, Word, Markdown), Inspect, Trash. Shift plus right-click keeps the browser menu.
3. Folder cards: folders as cards, click or double tap opens, sub-folders as cards above notes, breadcrumb back, two columns on phone; the folder filter opens this view.
Canvas: https://claude.ai/artifact/Ev7QAaDWddUJqsMSwsXgKk (old versions kept).

## 3. Share page
Full inventory with UI and gaps: docs/SHARE-PAGE-FEATURES.md.

## 4. Later
- Temporary MCP server tied to a share link: read the note, list and fetch its pictures, search inside it, append text on edit links; expires with the link.
- River and Orbit styles still use the old full-screen layout.
- Margin comments and snapshots inside full screen.
- Release v1.0.5 only when you say so.

## 5. Known issues
- e2e collab-panel and share-extras fail waiting for the typing status; they fail the same on commit 4b4830c, so they were there before this week.

## 6. Your side
- Delete D:\Peblo\_old-C-originals and D:\Downloads-from-C when happy.
- Remove empty leftovers in C:\Users\tejas\peblo-wt.
- Back up PEBLO_DATA_KEY in a password manager.
- Optional clean-up on C: npm cache, go-build cache, Downloaded Installations, Windows Disk Cleanup.

## 7. Rules I follow
Implement approved mockups exactly; never remove approved features; icons only, no emojis; run real tests on every change; mockup before new UI; push both branches after every change; never touch the Android emulator folders.
