# overlap-check: Log

## 2026-10-18

- Created from the "Create PR" demo analysis and the Ather UI Mockups canvas (F, H), after two Fable design reviews. The Ship card (mockups A, C) is split off as a follow-up so the shared check runs on the read-only board first.

## 2026-10-18, built

- Probed `git merge-tree --write-tree` on git 2.43: tree, stages per conflicted file, messages (binary, modify/delete).
- ather-automata: `overlap.mjs` (pairs, parse, places, `readOverlaps`, `fetchBranches`), the Branch line in `model.mjs`, `fetchArgs` for several branches and `complaintOf` in `team.mjs`; `tests/overlap.test.mjs` (12, real repositories).
- ather-board: records carry their collisions and a colliding warning; Triage and For you list Colliding after the decisions; actions and prompts; the pane and the page draw pairs; the check runs in the background after each read; the branches are fetched with the base. `tests/collide.test.mjs` (15).
- `dev/e2e/board.mjs`: the board in the engine on real git, in `dev/test-all.mjs`. Found and fixed with it: narrow rows cut the pair's names (D9); For you listed an intent twice; the opened details' white gap on the page.
- Tooling: the engine's API types (the plugin-authoring skill writes them) let the type-check run here; `npm install` in both Paseo packages let the Paseo type-check run. Lockfile churn from npm reverted.
- Fable checked the screenshots; thermo-nuclear review BLOCK, then PASS (progress.md A9, A10).
