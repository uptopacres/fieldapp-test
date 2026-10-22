# FieldApp TEST prototype

A throwaway demo of one farmer's single day. It shows the flow so people can approve the direction. It is not the real build: there's no login, no admin and no backend.

## Run / deploy
- **GitHub Pages:** push these files to a repo, then go to Settings → Pages → Deploy from branch (root). All paths are relative, so a `/<repo>/` subpath works.
- **Local:** run any static server, for example `npx serve .`. The service worker needs `http://localhost` or HTTPS; it won't run from a `file://` path.
- **Install:** "Add to Home Screen" on iOS or Android. The app works offline after the first load.

## Files
| File | What |
|---|---|
| `index.html` | Shell, viewport lock, font and manifest links |
| `styles.css` | The one stylesheet (brand tokens at the top) |
| `app.js` | Hardcoded day data, rating scales, state, rendering, `DataService` |
| `sw.js` | Offline cache (stale-while-revalidate). **Bump `CACHE` when you ship changes.** |
| `manifest.webmanifest`, `icons/` | Installable PWA |

## Check math (the hero denominator)
| | Checks |
|---|---|
| 3 site forms (one per submit) | 3 |
| 3 section work orders: Weekly pest check, Irrigation timer, Crops kale + collard status | 3 |
| 1 non-site work order: shredder drop | 1 |
| 1 Harvest Table: Columbia Square, 12:30 (featured; photo required) | 1 |
| **Total** | **8** |

The District Center crops order is a section work order too, which is why there are 3 of them, not 2.

## Rules implemented
- **Rating ≤ 3:** for Pests (Moderate/High/Severe) or a crop status of Struggling/Declining/Failed, a description is required and a "Photo suggested" prompt appears. "Done (retired)" is a terminal crop status with no score.
- **Marking a section work order "done":** must meet its checklist. That covers its require-description and require-photo toggles plus the ≤ 3 rule (stricter wins). The pest check also needs a pest level, and District Center needs Kale and Collards updated.
- **"Can't do":** needs a reason. A skipped work order still counts as resolved.
- **Submitting a site:** needs its work order resolved and every ≤ 3 description filled in. Nothing else is required.
- **Harvest Table:** a featured check with its own row. Completing it (on time or late) needs a photo (the quality and client record) and one engagement word: Packed 5 · Busy 4 · Steady 3 · Slow 2 · Crickets 1. The numbers are manager-only and are sent in the submit payload.
- **Autosave:** every change saves to localStorage. State resets automatically on a new calendar day, or use "Reset demo day" at the bottom of Home.

## Wiring a real backend later
Every submit (clock in/out, work order resolutions, site visits) goes through `DataService.submit(type, payload)` in `app.js`. Records currently land in a localStorage outbox (`fieldapp-test:outbox:v1`). Set `DataService.endpoint` to POST them instead. Payloads already include the manager-only numeric scores alongside the words.
