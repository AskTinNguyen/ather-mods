# overlap-check: Progress

Built 2026-10-18 on `ccr-c3eb09ca-i9bahh` (from origin/main 98abff1). PR #69. ather-board 0.1.1 → 0.2.0, ather-automata 0.4.0 → 0.4.1.

Evidence run (after every edit): `CLAUDE_CODE_TYPES=<the engine's claude-code.d.ts> node dev/test-all.mjs` → exit 0: Paseo copies in step and the Paseo type-check clean, board copies in step, mod type-check clean, unit 372/372, board 71/71, repos e2e 277/277, board e2e 15/15. The S2 e2e did not run (no S2 checkout here). `claude plugin validate` passed for both mods and the marketplace; `claude plugin test`: ather-automata 8/8, ather-board 12/12.

## Acceptance

| Id | Verdict | Evidence |
| --- | --- | --- |
| A1 | met | model.mjs reads `- Branch:` through `branchNamed` (backticks dropped, placeholders none). Unit: fixtures and this repository's own intents (track-guard, ather-board, decide-in-place). records.mjs `sidesOf`: open intents with a branch only (unit `collide.test.mjs`). The board e2e: the done intent's branch and the branchless intent are not fetched. |
| A2 | met | overlap.mjs `pairsToCheck`: each busy side against the base, two sides only when they share a file, one branch one piece of work. Unit on fixture file lists. |
| A3 | met | `parseMergeTree` (stages, binary files) and `spotsIn` (line in the first side's file, each side's first line, diff3 base skipped) unit-tested on git 2.43's own output; `readOverlaps` on real repositories (unit: main vs dodge, dash vs vault, a binary map; the board e2e: three places, the binary map, two intents' one line). |
| A4 | met | Unit: a stubbed `git version 2.30.1` reports nothing, makes no git call, and says "git 2.30 cannot check overlaps (needs 2.38)"; Triage shows it in Colliding's place (unit and pane test). |
| A5 | met | views.mjs `withColliding` (after the decisions, Triage and For you), the words in one home (`overlapCount`, `collisionOwners`, `collisionFact`, `spotLabel`, `sideLine`, `moreText`); act.mjs `collisionActions` and their prompts (unit, four cases); pane rows and the opened form (unit, stand-in elements; the board e2e at 72 and 110 columns, no layout problems; Bring main in hands exactly one prompt). |
| A6 | met | Unit: an unchanged second run is one git call; a moved branch is merged again. Board e2e: drawing again runs no merge-tree. |
| A7 | met | `/board open` writes the page with every collision in its data (board e2e); the page test runs every views.mjs export as written into the page, the collision helpers included, and every view's sections with collisions and the overlap note. Screenshots in `proof/`. |
| A8 | met, S2 owed | The evidence run above; versions and Changes lines in both mods and the marketplace; READMEs. One run with `S2_ROOT` before the next S2-facing change is owed: none was at hand. |
| A9 | met | Thermo-nuclear review: round 1 BLOCK (C1 a collision's words built on three surfaces; C2 "Colliding second" as slice arithmetic in two files; 8 non-critical), fixed in 85a86c3 and the commit after it; round 2 PASS, no critical findings; its two cosmetic notes: the "and N more" and "(blank)" words moved into views.mjs too, the `isDecisions` key test left as is. |
| A10 | met | `proof/`: the pane (Triage at 110 and 72 columns, For you) and the page (Triage, a pair opened, dark, phone, Table), made by `node dev/e2e/board.mjs --out` and Chromium; a Fable design check of them: the build matches the reviewed mockup; its two fixes taken (one-clause fact, code lines kept whole on a phone). |

## Findings

- F-1: the board's fetch brought only the base, so a clone knew no intent's branch. Fixed by D2a (ls-remote, then one fetch of the branches that moved).
- F-2: the Simple-view e2e merged in #68 expected Heading off?, which shows only in the evening. Fixed here: it is checked absent in Simple, not required in Advanced.
- F-3 (open, follow-up): naming the intent that merged the base's side ("hitstop-retune merged 6m ago") needs mapping commits to intents.
