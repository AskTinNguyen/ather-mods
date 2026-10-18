# Overlap check hardening

- Rev: 1
- Status: active
- Area: ather-board
- Owner: Tin Nguyen
- Skill: `plugin-authoring`
- Branch: `ccr-c3eb09ca-i9bahh`
- Started: 2026-10-18

## Goal

The overlap check shipped in ather-board 0.2.0 with three things owed: no number for what it costs on a repository of S2's size, nothing that keeps a slow first run from holding one long background job, and the base side named only by its last author ("origin/main changed these lines (Lena Park)") where the team thinks in intents. Pay them: a time budget, so a big first check is done in short runs that each show what they found; the intent whose merge brought the base's change ("hitstop-retune changed these lines on origin/main"); a benchmark with numbers; and the end-to-end helpers the runs share, in one module.

## Non-Goals

- The S2 end-to-end run itself: it needs an S2 checkout, which this environment does not have. It stays owed to the owner (Follow-ups).
- Checking the team's PCs' git versions: an owner's ten-minute check, not code (Follow-ups). Older git already degrades to a note (overlap-check D4).
- Moving run.mjs to the shared helpers: it runs only against an S2 checkout, so a change to it could not be run here.

## Sources

- The Fable review of the next-intents proposal (2026-10-18): hardening first; "a number for the S2 first run and the degradation when it is exceeded"; F-3 (naming the intent) is not small; fold the shared e2e helpers into this.
- overlap-check progress.md A8 ("met, S2 owed") and F-3; D6 ("on S2, the first run's diffs and merges can take a while").

## Decisions

- D1 (a time budget): `readOverlaps` starts new git work only within `budgetMs` (15 s by default) of its start. Past it, it returns what it found with `isPartial`, and its cache, so the next run goes on from where it stopped. The board runs again at once and draws between runs, so collisions appear as they are found. A run never stops a git call already started.
- D2 (the intent that brought the change): for a pair with the base, the base's last commit on the files is followed to where it reached the base's own line: the merge that brought it (a pull request's merge) or the commit itself (a squash, or a commit made on the base). The intent folders that change also wrote name the intent: a pull request that moved its intent's progress says whose it was. The fact then reads "hitstop-retune changed these lines on origin/main 6m ago (Lena Park)"; with no intent folder in that change, it reads as before.
- D3 (the benchmark): `node dev/bench/overlap.mjs` builds a repository of S2's shape (tens of thousands of files, binary maps, a long main, many open branches) and times the fetch, the first check in budgeted runs, and a check with nothing moved. The numbers are recorded in progress.md.
- D4 (shared e2e helpers): `dev/e2e/harness.mjs` holds the sandbox folder, the checks and their report, and the tree lookups; repos.mjs and board.mjs use it.

## Acceptance

| Id | Item | Proof |
| --- | --- | --- |
| A1 | A run past its budget returns partial; runs from its cache finish with the same overlaps as one unbudgeted run; a run after that makes one git call. | Unit, on a real repository with a clock that costs 10 ms a git call. |
| A2 | The intent is named from a pull request's merge and from a squash commit; a commit that wrote no intent folder names none. | Unit on real repositories; board e2e (Lena's retune lands by a merge, the fact names hitstop-retune). |
| A3 | Benchmark numbers for at least two sizes and one tight budget. | progress.md. |
| A4 | repos.mjs and board.mjs share harness.mjs; both pass unchanged. | test-all. |
| A5 | Gates green (test-all with the type-check and the Paseo type-check), validate and plugin test pass; ather-board 0.2.1, ather-automata 0.4.2 with Changes lines. | The runs. |
| A6 | Thermo-nuclear review PASS. | progress.md, PR. |

## Follow-ups

- Run `S2_ROOT=<an S2 checkout> node dev/test-all.mjs` once, and note how long the board's first Colliding takes on S2 itself.
- Check `git --version` on the team's PCs; below 2.38, Colliding says so.

## Changelog

- rev 1 (2026-10-18): created and built.
