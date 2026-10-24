# Progress: ather-lanes

- Working under rev: 3
- Worker: Opus background worker (started 2026-10-24)
- PR:
- Current step: S2, the mod skeleton and the pure readers (A1)
- Next step: S3, the pane per `design.md` (A2, A3)

## Acceptance

| Item | Verdict | Evidence |
| --- | --- | --- |
| A1 | open | |
| A2 | open | |
| A3 | open | |
| A4 | open | |
| A5 | open | |
| A6 | open | |

## Steps

- S0 (2026-10-24): read the spec, findings, review-rev1, ather-board sync.mjs and dev/test-all.mjs. Paused before any edit at the director's request for UX/UI mockups to be agreed first (L-3). Nothing written or reverted; gates not run (no code change).
- S1 (rev 3, 2026-10-24): the shared sync move (D1). `ather-board/sync.mjs` became `dev/sync-shared.mjs <mod> [--check]`, the same code with the mod as an argument; each mod names its entry modules in `<mod>/shared.json` (Board's six, unchanged). `dev/test-all.mjs` runs the check for every mod with a `shared.json`. Board's tests and copies unchanged. Evidence: before, `CLAUDE_CODE_TYPES=<automata types> node dev/test-all.mjs` exit 0: type-check clean, unit `397/397`, board `73/73`, repos e2e `329/329`, board e2e `18/18`; after, the same, with `ather-board: shared modules in step` from the new script; drift proof: one line appended to `ather-board/hooks/ather/rows.mjs` gives `out of step ... rows.mjs`, exit 1 (restored); `claude plugin validate ather-board` passed, `claude plugin test ather-board` 12 pass 0 fail. Paseo's `server/sync.mjs` is left as it is (it also versions package.json; not in D1's scope).

## Engineering calls

- E1 (S1): the entry list lives in `<mod>/shared.json` rather than in the dev script, so "each mod names its entry modules" (D1) holds and the script has no per-mod table.

## Reconciliations

- Rev 2 -> 3 (2026-10-24, 9b59b45, L-5): nothing was built under rev 2 (S0 was reading only), so nothing to redo. A2 and A3 now follow `design.md` (D7: Needs-you first; For you, A look, the fold; no columns or legends; lime only in For you, amber only on A look's reasons; quiet lanes hidden until the fold opens). D4 reworded to the opened-lane order of `design.md`. A1, A4-A6 and D1-D3, D6 unchanged.
