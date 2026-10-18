# Ather Board: counts that open, and a Timeline

- Rev: 1
- Status: active
- Area: ather-board
- Owner: Tin Nguyen
- Skill: `plugin-authoring`
- Branch: `ccr-c3eb09ca-i9bahh`
- Started: 2026-10-18

## Goal

People and Areas say how many intents, items, decisions and stale intents each person or area has, but a number only says there is something; finding it is another search. Make each count open what it counts. And give the page a view of the team's work over time: who has what in hand, since when, and what finished.

## Non-Goals

- The popover of mockup I (a count's list in place). Opening the view that lists them is the same list with its filters, sort and actions, and draws on every surface.
- Mockup G's per-intent activity feed: the board reads intents' files at origin/main, not their history of events, so it has no "D2 asked, PR opened" lines to show. Recorded as a deviation: the Timeline is per owner, over the dates the board does read (first and last commit).
- A Timeline in the pane: a terminal row cannot draw spans over weeks well; the pane keeps its seven views.

## Sources

- Mockups G and I (Ather UI Mockups, 2026-10-18) and the Fable review of the proposal: "board counts that open + timeline", lanes per owner, record the deviation from G.

## Decisions

- D1 (counts): `pickLook(look, by, value, count)`: open → the table of their intents (as the name); parked or done → the table at that stage (done shown); items → Open items; decisions and stale → Triage, where those are listed. Each cut to the person or area, the other filters cleared. The pane draws each count as a plain button (decisions and stale at full strength, the rest dim); the page as an underlined number in its cell. One `COUNT_KINDS` list.
- D2 (Timeline): `timeline(records, now, weeks)` in views.mjs (so the page's copy is the tested one): a lane per owner, the most spans first; each intent from its first commit to its last (now while open), packed into rows; a span begun before the window starts at its edge; done or parked work that ended before the window is left out. The page draws bars by stage with week lines; a bar opens that intent in the table.
- D3: an explicit set of intents (a bar, a brief's names) shows done ones too.

## Acceptance

| Id | Item | Proof |
| --- | --- | --- |
| A1 | Each count opens what it counts; the view lands on those intents. | Unit "board-counts D1"; board e2e (People's counts as presses at 72 and 110 columns without layout problems; the items count opens Open items); `proof/page-people.png` → `proof/page-people-pressed.png` (Lena's 12 items). |
| A2 | The Timeline's lanes and rows: no overlap in a row, clipped spans, old work left out. | Unit "board-counts D2"; the page test (the page's copy answers the same). |
| A3 | The page draws the Timeline light, dark and on a phone (scrolling sideways in its panel). | `proof/page-timeline*.png`, from `proof/rich-page.mjs.txt` over 18 intents. |
| A4 | Gates: `node dev/test-all.mjs` green, validate and plugin test; 0.3.0 with a Changes line. | The runs. |
| A5 | Thermo-nuclear review PASS on the branch's diff against main. | progress.md and the PR. |

## Changelog

- rev 1 (2026-10-18): created.
