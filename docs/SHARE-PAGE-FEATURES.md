# Peblo share page: every feature and how the UI shows it

Source: client/src/pages/SharedPage.jsx (read-only pages render plain HTML; edit links render the full editor). Status column: OK = fine, GAP = something to improve.

## 1. Top bar
| Feature | How the UI shows it | Status |
|---|---|---|
| Brand link | "Peblo" with dot, top left, goes home | OK |
| Breadcrumb | "Shared page > title" | OK |
| Preview as viewer (owner/editor only) | Eye button "Preview"; when on, a "View only / Can edit" switch appears | OK |
| Save to my Peblo | Primary button; becomes "Open saved copy" once saved | OK |
| Full screen | Maximize icon, key F | OK |
| Appearance | "Aa" icon opens a dialog: text size (A- A A+ A++), page width (narrow/normal/wide), font (sans/serif/mono), style (Owner/Soft/River/Orbit), theme (light/dark), show others' pointers, quiet mode, keep tool bar showing | OK |
| More options | Three dots menu: link box with Copy, export, print | GAP: contents differ for viewer and editor, not discoverable |

## 2. Left rail (page panels)
| Feature | UI | Status |
|---|---|---|
| Outline | List icon (key [); flyout "On this page", pin icon keeps it docked | OK (overlap with notes fixed in full screen) |
| People | Users icon (key ]) with count badge; docked drawer | OK |
| Comments | Message icon; disabled for view-only links with tooltip | GAP: disabled with no visible reason on touch |
| History | Clock icon with dot when there are changes; shows marks since last visit, "Jump back" to where you stopped, My bookmarks | OK |
| File | File icon; flyout with file actions | GAP: flyout contents small |

## 3. Reading features (viewer)
| Feature | UI | Status |
|---|---|---|
| Reading progress | Thin bar, "back to top" arrow after 5 percent | OK |
| Reading time and words | "N min read, N words" under the title | OK |
| Link expiry | "Link ends ..." in red under 24 hours; guests get "Ask to keep it going" | OK |
| Changes since last visit | Pill "N changes since your last visit" with Show marks / Hide marks | OK |
| Resume | Pill "You stopped at <heading>" with Jump back | OK |
| Bookmarks | Key B bookmarks the line under the pointer; popover lists them | OK |
| Find | Ctrl+F opens in-page find bar | OK |
| Keyboard shortcuts | "Keys" button or ? opens sheet | OK |
| Pictures | Click any picture: full-size view with Copy picture and Save (new) | OK |
| Tool dock | "Tools /" handle at the bottom, expands to Outline, People, Look, Full screen, Bookmarks, Keys | OK |
| Polls on the page | PagePolls widget under the text | OK |
| Task pages | Share of a to-do shows the task title, editable when allowed | OK |

## 4. Editing and live collaboration (edit links)
| Feature | UI | Status |
|---|---|---|
| Join card | Dialog asking name and colour, or "Just read, stay anonymous" | OK |
| Guest welcome strip | Name box and colour swatches above the title | OK |
| Live cursors and selections | Coloured carets with name flags; your own cursor hidden (fixed) | OK |
| Who is here | Pills in People drawer, dots on outline entries where people are | OK |
| Typing notices | "<name> is typing" pill; Quiet mode turns it off | GAP: known flaky test, see below |
| Edited by | Block tooltip "Edited by <name>" | OK |
| Comments | Margin comment threads for editors | OK |
| Table tools | Hover handles, merge, colours, open in new tab (fixed) | OK |
| Copy picture | Picture toolbar Copy button, lightbox Copy button (new) | OK |

## 5. Access states
| State | UI |
|---|---|
| Waiting room | Clock orb, name box, waits for the owner to let you in; "declined" state |
| Link ended or turned off | "Gone" page with explanation |
| Sign-in prompt | Modal with close button when an action needs an account |
| Revoke confirm | Owner-only confirm modal |

## 6. Phone layout
Bottom bar (mbar): Outline, People, Look, Link, Save. Outline opens as a bottom sheet. Rail and dock are hidden.

## 7. Gaps worth fixing next
1. More options menu: group into Share, Export, Print and show the same set for everyone.
2. Disabled Comments and History buttons should say why on touch screens.
3. Picture links: a temporary link-scoped MCP server that can hand pictures to Claude (see PEBLO-NEXT-FIXES.md section 9).
4. Known failing e2e (also fail on older commit 4b4830c, so not caused by recent work): collab-panel and share-extras, both waiting for the typing status.
