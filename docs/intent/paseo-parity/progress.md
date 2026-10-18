# paseo-parity: Progress

Built and closed 2026-10-18 on `ccr-c3eb09ca-i9bahh` (from origin/main 4715f1b). ather-automata 0.6.0 → 0.6.1 (shared code only), Paseo 0.6.1.

Evidence run: `CLAUDE_CODE_TYPES=<the engine's claude-code.d.ts> node dev/test-all.mjs` → exit 0: type-check, the Paseo type-check (server and panel), unit 380/380, board 73/73, repos e2e 286/286, board e2e 17/17, Paseo e2e 9/9. `claude plugin validate` passed and `claude plugin test` passed for both mods (8, 12).

## Acceptance

| Id | Verdict | Evidence |
| --- | --- | --- |
| A1 | met | `proof/paseo-report.md`: the collision in Needs you after the fetch, the merge line in warning, the pill "1 needs you". |
| A2 | met | Same: `/ather simple` leaves title, status, needs, attention, next and view; the toggle brings every part back. |
| A3 | met | Same: merges cleanly once main is merged in, the item gone, the pill `● Build 1/2 · feat-x`. |
| A4 | met | The evidence run. The panel is type-checked, not drawn (no Paseo app here): a look in Paseo is owed. |
| A5 | met | Thermo-nuclear review round 1: PASS, no critical findings. Taken: the branch check moved into server/team.ts beside the other per-checkout state, with `repoOf` typed as `Repo` (no cast, no new export). Left: the panel's 13 `shows(…)` checks stay inline beside the conditions they join, as console.mjs names its parts; `shows` stays an array of strings in the contract, since typing it would copy HOME_PARTS into the client bundle. |
