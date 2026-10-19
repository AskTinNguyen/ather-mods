# ship-pill: Progress

Built and closed 2026-10-18 on `ccr-c3eb09ca-i9bahh` (from origin/main 09e1dac). ather-automata 0.5.0 → 0.6.0 (Paseo 0.6.0, shared code).

Evidence run: `CLAUDE_CODE_TYPES=<the engine's claude-code.d.ts> node dev/test-all.mjs` → exit 0: type-check and the Paseo type-check clean, unit 380/380, board 73/73, repos e2e 286/286, board e2e 17/17. `claude plugin validate` passed and `claude plugin test` passed for both mods (8, 12).

## Acceptance

| Id | Verdict | Evidence |
| --- | --- | --- |
| A1 | met | Unit "collision-alert: a side with its own tip …": `compared` is ['here'] with a tip, [] without. |
| A2 | met | Unit "collision-alert: this checkout's branch …": amber with overlaps, clean "checked 1m ago" and "just now", none without a check. |
| A3 | met | Unit "ship-pill D2". |
| A4 | met | repos e2e: the merge line in amber, then "Merges cleanly into origin/main · checked just now" once main is merged in, and the band's `● Build 1/2 · feat-x` once nothing needs you. `proof/home-merge-72.png`, `proof/band-110.png`, the text beside them. |
| A5 | met | The evidence run; Changes lines (mod, Paseo). |
| A6 | met | Thermo-nuclear review round 1: BLOCK, C1: the pill's glyph map copied the work list's by hand. Fixed in 15478a4: built from `STAGE_GLYPHS` with `PLAN_GLYPH` and `SHIPPED_GLYPH` beside it, `isPlanned` computed once; with the non-critical ones (a plain sameness check, `MergeCheck` without its unused branch, `mergeRow` in rows.mjs, the band's words in locals). Round 2: PASS. Left: one shared "just now" wording across modules (older than this branch). |
