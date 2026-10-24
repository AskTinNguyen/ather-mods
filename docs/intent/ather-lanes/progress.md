# Progress: ather-lanes

- Working under rev: 3
- Worker: Opus background worker (started 2026-10-24)
- PR:
- Current step: S3, the Windows contract test (A6) and the scratch live proofs (A2 ii, A3 live)
- Next step: S4, the live sessions (A3 screenshots, A4 trace, A5 both mods), then the thermo-nuclear review and the draft PR

## Acceptance

| Item | Verdict | Evidence |
| --- | --- | --- |
| A1 | met | S2: `tests/lanes.test.mjs` readers and records on `tests/fixtures/machine.mjs` (every case A1 names), 23/23 in test-all |
| A2 | open | (i) and (iii) done in S2; (ii) the live scratch take and release owed |
| A3 | open | fixture half done in S2 (`claude plugin test` 6/6); the live compare and the screenshots owed |
| A4 | open | |
| A5 | open | validate and the `register` test done in S2; the live two-mod session owed |
| A6 | open | |

## Steps

- S0 (2026-10-24): read the spec, findings, review-rev1, ather-board sync.mjs and dev/test-all.mjs. Paused before any edit at the director's request for UX/UI mockups to be agreed first (L-3). Nothing written or reverted; gates not run (no code change).
- S1 (rev 3, 2026-10-24): the shared sync move (D1). `ather-board/sync.mjs` became `dev/sync-shared.mjs <mod> [--check]`, the same code with the mod as an argument; each mod names its entry modules in `<mod>/shared.json` (Board's six, unchanged). `dev/test-all.mjs` runs the check for every mod with a `shared.json`. Board's tests and copies unchanged. Evidence: before, `CLAUDE_CODE_TYPES=<automata types> node dev/test-all.mjs` exit 0: type-check clean, unit `397/397`, board `73/73`, repos e2e `329/329`, board e2e `18/18`; after, the same, with `ather-board: shared modules in step` from the new script; drift proof: one line appended to `ather-board/hooks/ather/rows.mjs` gives `out of step ... rows.mjs`, exit 1 (restored); `claude plugin validate ather-board` passed, `claude plugin test ather-board` 12 pass 0 fail. Paseo's `server/sync.mjs` is left as it is (it also versions package.json; not in D1's scope).
- S2 (rev 3, 2026-10-24): the mod, `ather-lanes/` 0.1.0. `hooks/sources.mjs` (one pure reader per source, D2), `records.mjs` (A1 records), `board.mjs` (design.md's For you, A look, fold, holds, opened-lane details), `pane.mjs` (the pane as lines of segments, then drawn), `index.mjs` (the engine half: `/lanes`, the shown-only timer, one process at a time, gh kept in the store). Shared copies through `dev/sync-shared.mjs ather-lanes` (`shared.json`: rows, worklist, model, packs/unreal; 18 files with their imports). `dev/test-all.mjs` type-checks Lanes' hooks and runs its unit tests. Marketplace entry, the mod's README (the one write it causes, the cadence, the settings), root README rows. Evidence: `node --test ather-lanes/tests/lanes.test.mjs` 23 pass (readers on good and bad input, records keep Status' kind, A2 (i) holder and end equal `parseEditorLock` of the Sync pointer, perf as one hold, design.md's sections and members, every line <= 72 and <= 110 at rest/opened/unfolded, lime only on For you's label and count, amber only on A look's reasons, a quiet lane absent until the fold opens, the opened lane's order, the Register line, `register` adds only session.start, command.run, ui.close, ui.render); `claude plugin test ather-lanes` 6 pass 0 fail (the pane on terminal 72/110 and desktop from fixtures with every reason, a quiet lane and an all-quiet machine; registered and unregistered lanes pressed open and closed; nothing runs before /lanes or while hidden or closed; in 10 shown minutes 6 Status runs and 3 gh; r runs Status at once; no machine folder: said, rest drawn, no process; an Edit and a `gh pr merge` call: no toast, no process); `claude plugin validate ather-lanes` passed, hooks listed: session.start, command.run{lanes}, ui.close{lanes}, ui.render{Pane lanes}; `CLAUDE_CODE_TYPES=<automata types> node dev/test-all.mjs` exit 0: type-check clean (Lanes included), unit `397/397`, board `73/73`, lanes `23/23`, repos e2e `329/329`, board e2e `18/18`, `ather-board` and `ather-lanes: shared modules in step`; A2 (iii): `grep -rnE "fs\.write|\.write\(|writeFile|appendFile|mkdir|editor-slot" ather-lanes/hooks` finds nothing (exit 1); over all of `ather-lanes/` only README prose and fixture comments name editor-slot.ps1. Acceptance: A1 met; A2 (i), (iii) done, (ii) owed; A3 fixture half done, live half owed; A5 construction half done.

## Engineering calls

- E1 (S1): the entry list lives in `<mod>/shared.json` rather than in the dev script, so "each mod names its entry modules" (D1) holds and the script has no per-mod table.

- E2 (S2): "past its end" is any time after the slot's end (design.md shows "past its end 6m"); `parseEditorLock`'s `isStale` (30 minutes, the Reclaim rule) is kept on the record but is not the reason. The end is parseEditorLock's `until` (HH:MM), read in its 12-hour window.
- E3 (S2): "needs a slot that another lane holds": the lane's sidecar `slot` need is light or full, it holds none of that kind, and every slot of that kind is held by another lane. The counts come from `slot-counts.json` (the machine folder's, else the skill's `data\`), the same files `editor-slot.ps1` reads; unread counts are taken as one (F-8 (3) asks Status for them).
- E4 (S2): a perf capture is one hold labelled "every slot" (A2), not one line per slot.
- E5 (S2): "unregistered" is a reason only for Status kind `lane` (a worktree under the lanes folder); a harness worktree or other worktree is shown with ○ in the fold but not flagged.
- E6 (S2): a decision's age for For you's order is the date in its finding heading ("## F-2 (2026-10-19, ...)"); one without a date sorts last.
- E7 (S2): the Register line, too wide at 72 columns, is broken with PowerShell's backtick continuation, so the two lines still paste as one command.
- E8 (S2): the gh call runs from the machine folder (outside any checkout, D2.4), with `--limit` four times the branch count (at least 30), and the answer is kept in `$.store` under `prs:<owner/repo>` with its time and branches.
- E9 (S2): times come from `$.clock.now()` so the engine's mocked clock drives the tests; "never read" is a sentinel, not time 0.
- E10 (S2): the draw hook starts nothing: a refresh is queued with `$.clock.after(0, …)` from `/lanes` and from a draw after a reload, so no process runs on a hook's path.

## Reconciliations

- Rev 2 -> 3 (2026-10-24, 9b59b45, L-5): nothing was built under rev 2 (S0 was reading only), so nothing to redo. A2 and A3 now follow `design.md` (D7: Needs-you first; For you, A look, the fold; no columns or legends; lime only in For you, amber only on A look's reasons; quiet lanes hidden until the fold opens). D4 reworded to the opened-lane order of `design.md`. A1, A4-A6 and D1-D3, D6 unchanged.
