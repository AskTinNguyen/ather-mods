# Ather Automata: a collision with the base in Needs you

- Rev: 1
- Status: completed
- Area: ather-automata
- Owner: Tin Nguyen
- Skill: `plugin-authoring`
- Branch: `ccr-c3eb09ca-i9bahh`
- Started: 2026-10-18

## Goal

Ather Board shows the team which open intents collide (overlap-check). The person whose branch fell behind should not have to open the board to learn it. When this checkout's own branch no longer merges cleanly into origin's base, say so in Needs you, with who changed the lines and where, and offer the one press that fixes it: bring the base in. The collision's words and actions become one shared module, so the board and Automata say it the same way.

## Non-Goals

- Teammates' collisions in Automata (the board's job).
- Pushing, or merging for the person: the press hands the session a prompt that shows every resolution before committing and pushes nothing.
- The Paseo panel (it lags: README Limits).

## Sources

- The proposal of next intents, as Fable revised it (2026-10-18): "shared collision layer + local side", then "collision alert in Needs you", modelled on the lost-edits item; ▲ in the band; Bring main in.
- overlap-check and overlap-hardening (completed): `readOverlaps`, the budget, the intent behind a base change.

## Decisions

- D1 (one layer): `hooks/collide.mjs` holds a collision's sides (`Party`, `Collision`, generic over the stage), `collisionsFor`, the words (`overlapCount` … `spotLabel`, `spotsText`) and the actions (`bringPrompt`, `collisionActions`). Ather Board re-exports the words (its page writes them by their source) and imports the rest; nothing of it stays in the board.
- D2 (local side): a `Side` may bring its own `tip`; it is compared though origin has no copy of its branch. This checkout's branch is compared with its HEAD, so commits not pushed count.
- D3 (one runner): `overlapJob()` in `overlap.mjs` runs the check in the background, one run at a time, one more after an ask that came while it ran, and again after a partial run. The board's own loop is replaced by it.
- D4 (when): after each read of the intents (a turn's end, a fetch of the base, `/ather`); detached, on the base itself, or outside git, nothing is checked.
- D5 (the item): kind `collide`, after lost edits. The label says the action ("Bring origin/main into feat/x"); the detail says ▲ how many, the fact (who, when, which intent's merge) and the places. Its id changes with the places, so a handed-over one comes back only when they change. The band: "▲ feat/x no longer merges cleanly into origin/main · /ather", after a queued press and before the newcomer's tour.
- D6 (named by): the tracked intent's slug when one is tracked, else the branch ("The branch feat/x no longer merges …").

## Acceptance

| Id | Item | Proof |
| --- | --- | --- |
| A1 | `collide.mjs` holds the words and actions; the board's views, pane, page and actions use it and draw the same. | Board unit 71/71 (the page runs every word as written into it), board e2e 15/15, proof/board-*.png. |
| A2 | A side with its own tip is compared without a copy on origin; without one it is not. | Unit "collision-alert: a side with its own tip". |
| A3 | `overlapJob`: one run at a time, the newest ask runs next, a partial run is followed, an error ends the job and the next ask starts again. | Units "the check as a background job". |
| A4 | Needs you's item: label, title, detail and prompt, by intent or by branch; none without a collision. | Unit "collision-alert: this checkout's branch". |
| A5 | On real git through the engine: a local commit and a teammate's push to main on the same line give the item after the fetch, in Advanced and Simple, and ▲ in the band; the press hands the merge prompt; merging main in clears it. | repos e2e (collision-alert block); proof/needs-you-72.png, proof/band-110.png. |
| A6 | Gates: `node dev/test-all.mjs` green (type-check included), copies in step, validate and plugin test for both mods; ather-automata 0.5.0, ather-board 0.2.2, Changes lines. | The runs. |
| A7 | Thermo-nuclear review PASS on the branch's diff against main. | progress.md and the PR. |

## Changelog

- rev 1 (2026-10-18): created; the shared collision layer (planned as its own intent) folded in, as its only reason is this second user.
