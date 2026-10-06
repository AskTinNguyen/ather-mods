# track-guard: Progress

- Working under rev: 1
- Worker: none yet
- Current step: none
- Next step: S1, untrack (A1) with its unit tests
- PR: none

## Acceptance

<!-- One row per acceptance id in prompt.md, same order. Verdict is exactly met or open; met needs evidence (commit / command and its result line). -->

| Item | Verdict | Evidence |
| --- | --- | --- |
| A1 | open | |
| A2 | open | |
| A3 | open | |
| A4 | open | |
| A5 | open | |
| A6 | open | |
| A7 | open | |
| A8 | open | |

## Steps

<!-- S<n> (rev <r>, <YYYY-MM-DD>): <what was done>. Evidence: <commit / command and result line / PR>. Acceptance: <A-ids moved>. -->

- S0 (rev 1, 2026-10-06): baseline on `main` 24eb1f4 in this worktree: `S2_ROOT=E:/Projects/s2 node dev/test-all.mjs --layouts <scratch>/tg-base` → `105/105 passed`, `184/185 passed` (the one failure: "a teammate's name sits in its own column at the right edge", which depends on the S2 checkout's current intents). Layouts kept outside the repo for the A7 diff. Acceptance: none (baseline).
