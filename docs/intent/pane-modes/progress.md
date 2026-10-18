# pane-modes: Progress

Built and closed 2026-10-18 on `ccr-c3eb09ca-i9bahh` (from origin/main 25ccb0c). ather-automata 0.4.2 → 0.4.3.

Evidence run: `CLAUDE_CODE_TYPES=<the engine's claude-code.d.ts> node dev/test-all.mjs` → exit 0: type-check and the Paseo type-check clean, unit 375/375, board 71/71, repos e2e 277/277, board e2e 15/15. The S2 e2e ran only over stand-in intents (proof/layouts.md).

## Acceptance

| Id | Verdict | Evidence |
| --- | --- | --- |
| A1 | met | `hooks/modes.mjs`: `pickRows`, `issueRows`, `intentRows`, `createRows`, `skillsRows`, `awayRows`, `awayWindowRows`; `paneView` picks the mode, makes the presses and adds the foot. `console.mjs` 2,232 → 2,122 lines. Unit "the modes past Home (modes.mjs)". |
| A2 | met | proof/layouts.md: 120 layouts at 72 and 110 columns, byte-identical to main's (sha256), with the one Home tie explained; `proof/modes-72.png`, `proof/modes-72-b.png`. |
| A3 | met | The evidence run; `claude plugin validate ather-automata` passed, `claude plugin test ather-automata` 8 pass; 0.4.3 with Changes lines (mod and Paseo). |
| A4 | met | Thermo-nuclear review round 1: PASS, no critical findings. Of seven non-critical ones, fixed: the placeholder presses (Next and End now ride in the view with their press), one Back helper used by the intent view too, `pickRows` no longer restates `workGroups`' defaults, and a unit test for the module. Left: one hotkey helper across `rows.mjs`/`modes.mjs`/`console.mjs` (`rows.mjs` writes it inline eight times; a sweep of its own), `issueRows` taking the Open control built in `console.mjs` (it needs `$` to open the browser in the terminal), and one return site for the modes (modest gain). |
