# collision-alert: Progress

Built and closed 2026-10-18 on `ccr-c3eb09ca-i9bahh` (from origin/main 8f41f7e). ather-automata 0.4.3 → 0.5.0, ather-board 0.2.1 → 0.2.2.

Evidence run: `CLAUDE_CODE_TYPES=<the engine's claude-code.d.ts> node dev/test-all.mjs` → exit 0: type-check and the Paseo type-check clean, unit 379/379, board 71/71, repos e2e 283/283, board e2e 15/15. `claude plugin validate` passed and `claude plugin test` passed for both mods (8 and 12). The S2 e2e did not run (no S2 checkout here).

## Acceptance

| Id | Verdict | Evidence |
| --- | --- | --- |
| A1 | met | `hooks/collide.mjs`; the board's views.mjs re-exports the words, act.mjs keeps no collision code, records.mjs uses `collisionsFor`. Board unit 71/71 (the page test runs every word as written into the page), board e2e 15/15; `proof/board-pane-triage-110.png`, `proof/board-page-triage-opened.png`. |
| A2 | met | Unit "collision-alert: a side with its own tip needs no copy on origin" on a real repository: the unpushed branch collides with Lena's line; the same branch without a tip is not compared. |
| A3 | met | Units "the check as a background job (overlapJob)". |
| A4 | met | Unit "collision-alert: this checkout's branch …": label, title, detail, prompt; by intent and by branch; none without a collision. |
| A5 | met | repos e2e, collision-alert block (6 checks): the item after the fetch, its words, ▲ in the band, the Simple view, the press's prompt, cleared once main is merged in. `proof/needs-you-72.png`, `proof/band-110.png`, the text in `proof/collide-*.txt` (`node dev/e2e/repos.mjs --out <dir>`). |
| A6 | met | The evidence run; versions and Changes lines (both mods, Paseo). |
| A7 | met | Thermo-nuclear review round 1: PASS, no critical findings. Open with reasons: (1) the board's action reads "Bring main into dodge-cancel" and Needs you's "Bring origin/main into feat/x": D5 chose the branch for this checkout's own item, where the branch is what the person sees; (2) `refresh()` in console.mjs hand-rolls the serial pattern `overlapJob` encodes: older code, a follow-up for one serial-runner primitive; (3) `HomeInput.collision` is optional: the Paseo server calls `buildHome` without it; (4) `showCollision` compares by JSON: the collision is plain data, and its age fields count too; (5) console.mjs size: the check is 25 lines beside the fetch it follows; (6) `runArgs` also fixes the board run's argument parse when `--out` is absent. |
