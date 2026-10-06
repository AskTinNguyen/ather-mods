# web-pack: Progress

- Working under rev: 1
- Worker: `web-pack-worker`
- Current step: S2: read the Unreal specifics and design the pack interface
- Next step: move the Unreal specifics into `packs/unreal.mjs`, layouts identical to the S1 baseline
- PR: none yet

## Acceptance

<!-- One row per acceptance id in prompt.md, same order. Verdict is exactly met or open; met needs evidence (commit / command and its result line). -->

| Item | Verdict | Evidence |
| --- | --- | --- |
| A1 | open | baseline recorded (S1); refactor not started |
| A2 | open | |
| A3 | open | |
| A4 | open | |
| A5 | open | |
| A6 | open | |
| A7 | open | |

## Steps

<!-- S<n> (rev <r>, <YYYY-MM-DD>): <what was done>. Evidence: <commit / command and result line / PR>. Acceptance: <A-ids moved>. -->

- S1 (rev 1, 2026-10-06): baseline before any refactor. Added `--layouts <dir>` to `dev/test-all.mjs` (passed to `dev/e2e/run.mjs`; every `check()` layout at 72 and 110 columns written to `layouts-72.txt` / `layouts-110.txt`), and a `node:test` adapter so the plain `node --test` gate resolves `claude-code/testing` (F-1). On base `2f25364`: `S2_ROOT=E:/S2_ node dev/test-all.mjs --layouts base1` → `75/75 passed`, `185/185 passed`; a second run `base2` → identical layouts (`diff` empty, 399 + 83 lines), so the dump is deterministic against a fixed S2 state. `node --test ather-automata/tests/*.test.mjs` → `ℹ pass 75 ℹ fail 0`. Evidence: this commit. Acceptance: A1 (baseline only).

## Decisions (worker)

- W1: layouts are compared per `check()` call in run order; any difference in order, text or count is a regression.

## Reconciliations

<!-- rev <old> -> <new>: still valid <...>; redo <...>; dropped <...>. -->
