# overlap-hardening: Progress

Built and closed 2026-10-18 on `ccr-c3eb09ca-i9bahh` (from origin/main 5683e7e). ather-board 0.2.0 → 0.2.1, ather-automata 0.4.1 → 0.4.2.

Evidence run: `CLAUDE_CODE_TYPES=<the engine's claude-code.d.ts> node dev/test-all.mjs` → exit 0: type-check and the Paseo type-check clean, unit 374/374, board 71/71, repos e2e 277/277, board e2e 15/15. The S2 e2e did not run (no S2 checkout here).

## Acceptance

| Id | Verdict | Evidence |
| --- | --- | --- |
| A1 | met | Unit "hardening D1": a 25 ms budget with a git call costing 10 ms gives a partial first run; runs from its cache finish with the same overlap keys as an unbudgeted run; one more run makes one git call. Benchmark at a 300 ms budget: 7 runs, the slowest 336 ms. |
| A2 | met | Unit "hardening D2" on real repositories: a commit on main names none; a pull request's merge names hitstop-retune; a squash commit names hitstop-squash. Board e2e: Lena's retune lands by a merge and the opened pair reads "hitstop-retune changed these lines on origin/main … (Lena Park)." (`proof/page-triage-opened.png`, `proof/pane-triage-110.*`). |
| A3 | met | `node dev/bench/overlap.mjs` on git 2.43: 30,000 files, 40 branches, 300 main commits: fetch 63 ms, first check 1.5 s in one run (38 overlaps), nothing moved 5 ms and one git call (`proof/bench-30k-40.json`). 100,000 files, 120 branches: first check 5.2 s, nothing moved 11 ms, one git call. 30,000 files at a 300 ms budget: 7 runs, slowest 336 ms. |
| A4 | met | `dev/e2e/harness.mjs` (sandbox, checks, report, tree lookups, until); repos.mjs 277/277 and board.mjs 15/15 unchanged. |
| A5 | met | The evidence run; `claude plugin validate` and `claude plugin test` (below); versions and Changes lines. |
| A6 | met | Thermo-nuclear review: round 1 BLOCK (C1 `intentsIn` copied team.mjs `slugOf`; C2 the budget's flag and doubled branches in `readOverlaps`; C3 the bench's two clocks and own sandbox), fixed in 3cf9de7 with five non-critical findings (a run could make no progress when the budget ran out before new work; the board loop's flag reused; the base's fields grouped as `base`; `collisionFact` and `broughtBy` read more plainly, `broughtBy` kept per commit within a run; leftovers of the harness move); round 2 PASS. |
