# Ather Automata: the pane's modes out of console.mjs

- Rev: 1
- Status: active
- Area: ather-automata
- Owner: Tin Nguyen
- Skill: `plugin-authoring`
- Branch: `ccr-c3eb09ca-i9bahh`
- Started: 2026-10-18

## Goal

`console.mjs` is 2,232 lines, and `paneView` draws Home and seven other modes inline. The next intent (collision-alert) adds to Home and Needs you there. Move the modes past Home into a pure module, drawn from what `console.mjs` hands them, as `rows.mjs` draws Needs you and Everything open's groups, and prove nothing a person sees changes.

## Non-Goals

- Changing any mode's look, keys, focus or presses.
- Moving Home (it stays in `paneView`, where the Simple view's parts are named) or the finding view (already `rows.mjs` `findingRows`).
- The Paseo panel: it draws its own screens; the copy of `modes.mjs` rides along unused.

## Sources

- The Fable review of the next-intents proposal (2026-10-18): split pane modes before adding the collision alert to Home.
- AGENTS.md: a restructuring must not change behaviour.

## Decisions

- D1 (home): `hooks/modes.mjs`, pure (no `$`): `pickRows`, `issueRows`, `intentRows`, `createRows`, `skillsRows`, `awayRows`, `awayWindowRows`. Each takes `(el, frame, view, on)`: where it is drawn, what it shows, its presses. `console.mjs` keeps the mode switch, the state (search, folds, the shown intent) and every press.
- D2 (one Back): the modes' Back rows are one helper.
- D3 (proof of no change): the S2 e2e's `--layouts` dump of every pane and band at 72 and 110 columns, run on main and on the branch over the same stand-in S2 intents (there is no S2 checkout here), must be byte-identical.

## Acceptance

| Id | Item | Proof |
| --- | --- | --- |
| A1 | The seven modes are drawn by `modes.mjs`; `paneView` only picks the mode and makes the presses. | The diff. |
| A2 | Every pane laid out by the S2 e2e is identical before and after, at 72 and 110 columns. | `proof/layouts.md`. |
| A3 | Gates: `node dev/test-all.mjs` green (type-check included), copies in step, `claude plugin validate` and `claude plugin test` pass; 0.4.3 with a Changes line. | The runs. |
| A4 | Thermo-nuclear review PASS on the branch's diff against main. | progress.md and the PR. |

## Changelog

- rev 1 (2026-10-18): created.
