# Ather Lanes: the agreed pane (rev 3)

Agreed by the director on 2026-10-24 (L-5): Round 2's direction **2 · Needs-you first** for the pane, with direction **1 · Calm list**'s layout for an opened lane and for the unfolded list. The mockups are on the director's private design canvas ("Ather Lanes mockups", page Round 2: `R2-Inbox-*` and `R2-List-Open`); this file is the record. Lane names here are made up.

## The idea

The rows are what to act on, not the lanes. The pane answers "does anything need me?" in two seconds: the director's decisions first, then the lanes in trouble, then one folded line for everything else. A lane that is fine says nothing until asked.

## Terminal, 72 columns, at rest

```
L A N E S                                       main as of 19:04 · ↻ 40s

F O R   Y O U                                                6 decisions
  editor-fix      F-2  Hide inactive actors in the outliner by default?
                  F-4  Keep the old filter as a menu item for one relea…
                  F-5  Ship behind a console variable first?
  s2              F-1  Pool size: keep 2 ready lanes, or 3?
                  F-3  Leave harness worktrees out of Status?
  combat-hitstop  F-2  Apply hitstop to parries as well?

A   L O O K                                                            3
  editor-fix      #398 checks failing · 27 behind main
  perf-capture    light-1 past its end 6m · a perf hold
  scratch-a       unregistered · no sidecar, so no intent or claims

▸ all 7 lanes · pool 2 ready, 1 building · Editor: combat-hitstop, 34m
                                 enter opens a lane or the fold · r ↻
```

- **For you** (lime label and count): every waiting decision (`directorCalls` of the lane's intent), one line each, its id and title, under its lane's name; a lane's name only on its first line. Lanes ordered by their oldest waiting decision. Titles are cut with `…` to fit.
- **A look** (label in ink, count; each reason amber): one line per lane in trouble, its reasons joined by ` · `, worst first. The reasons, and nothing else: PR checks failing; behind `main` by 25 or more (a constant in one place); a slot held past its end; needs a slot that another lane holds; unregistered. A lane in For you can also be here.
- **The fold** (quiet): one line, always last: how many worktrees, the pool, and the Editor slot's holder with time left (or "Editor free"). It is the only place the Editor holder shows at rest.
- **Header**: the label, then on the right `origin/main`'s age and the last refresh. No legend, no key list; one quiet hint line at the bottom.
- **Nothing waiting and no trouble**: For you and A look are replaced by one ink line, "Nothing needs you.", then the fold.
- Colour: lime only for For you; amber only for A look's reasons; everything else ink or quiet.

## A lane opened in place (from either section)

The item's line gains `▾` and the lane's details open under it, one label a line (Calm list's opened layout):

```
▾ perf-capture    light-1 past its end 6m · a perf hold
    slot  perf hold on every slot · ended 20:04 · needs light
    moved lane heartbeat 2m ago · last commit 4h ago
    main  up to date · 2 ahead
    PR    none yet
    lane  perf/frame-budget · frame-budget · T2 · <lane path>
          decisions none
```

- Order: decisions (when the lane has any, full titles, then "answer them in the session that tracks <intent>"), then `PR` (number, state, checks, "open on GitHub ↗"), `main` (behind, ahead, `origin/main`'s age when not shown above), `slot` (need, held, when a held one frees), `moved` (newest source first: commit, session heartbeat, lane heartbeat; "no heartbeat here" when none), `lane` (branch, intent, tier, path).
- An unregistered lane opens to one sentence and the `lanes.ps1 -Action Register -Name <lane> -Intent <slug> -Tier <T0|T1|T2>` line to copy.
- One lane open at a time; enter closes it. Nothing here changes a lane.

## The fold opened: every lane

`enter` on the fold replaces it with Calm list's rows, one line a lane, at most one phrase (lime "N decisions", else the first amber reason, else nothing) and its last-moved age; lane 0 first, then by name; the pool folded into one line; then the held slots, one line each (holder, kind, time left or "past its end", and who waits for it), or "all slots free":

```
▾ all 7 lanes · pool 2 ready, 1 building
  ◆ s2              2 decisions                                       3m
  ● combat-hitstop  1 decision                                        6m
  ● docs-sweep                                                        2h
  ● editor-fix      3 decisions · checks failing                      1h
  ● perf-capture    slot past its end                                 2m
  ● ui-inventory                                                     41m
  ○ scratch-a       unregistered                                      3d
    pool            2 ready · 1 building
  full-1   combat-hitstop · editor · 34m left · then editor-fix
  light-1  perf-capture · perf · past its end 6m
```

Any lane here opens in place as above.

## Wider terminals

At 110 columns the layout is the same; titles and reasons are cut later. No extra columns.

## Desktop side panel (about 420 px)

The same three parts in proportional type: FOR YOU with each lane name in bold above its decisions; A LOOK with each lane and its amber reasons; the fold as a button ("All 7 lanes · pool 2 ready, 1 building") and one line "Editor slot: combat-hitstop · 34m left · then editor-fix". Every lane, decision and trouble is a real button that opens the lane in place. ↻ is a button with its label.
