# Ather Automata: the merge line and the stage pill (mockups A and C, without the Ship card)

- Rev: 1
- Status: completed
- Area: ather-automata
- Owner: Tin Nguyen
- Skill: `plugin-authoring`
- Branch: `ccr-c3eb09ca-i9bahh`
- Started: 2026-10-18

## Goal

Mockup A (the Ship card) answered one question the pane never did: will my branch merge? Mockup C (the pill) put the tracked work's stage above the prompt. collision-alert already says when the branch will not merge; say when it will, and when that was checked, and let the line above the prompt show the stage when nothing needs the person.

## Non-Goals

- The Ship card itself. The Fable review of the proposal advised it "only if the alert leaves demand, and without the commit graph". Each of its states (A1–A5) already has a place:
  - Proving (A1): the stage track, the proof line, Next.
  - Overlap with main (A2): Needs you's Bring origin/main in, ▲ above the prompt, and now the merge line in amber.
  - Bringing main in (A3): the item, marked sent or queued once pressed.
  - Ready to close (A4): Needs attention's ✓ and the pill.
  - Done (A5): the stage track's Shipped.

  A card would show these a second time. Recorded as a decision; it can come back if the team asks for it.
- The commit graph (A): never.
- The diff stat beside the pill (C, "+482 −37"): it would need a git call per drawing of the band.

## Sources

- Mockups A and C (Ather UI Mockups, 2026-10-18) and both Fable design reviews (drop the card's label and grey sentence; colour shows the stage).
- collision-alert (completed): the check of this checkout's branch against origin's base.

## Decisions

- D1 (merge line): `readOverlaps` says which sides it compared with the base (`compared`), so "merges cleanly" is said only when the branch was actually merged with it, never when origin's base is missing or nothing changed. Home's masthead, Advanced view: `Merges cleanly into origin/main · checked 2m ago` in quiet, or `▲ N overlaps with origin/main · see Needs you` in amber. A run that ran out of time leaves the last answer. A check that finds the same only moves "checked … ago".
- D2 (pill): `header.pill` is the tracked intent's stage glyph (○ planned or plan, ● build, ◐ prove or ship, ✓ ready to close, ■ shipped), its stage, its items met and its key. The band shows it when nothing needs you, in place of the dim "◆ Ather Automata"; what needs you still wins.

## Acceptance

| Id | Item | Proof |
| --- | --- | --- |
| A1 | `compared` names the sides merged with the base; none for a side without a tip on origin. | Unit "collision-alert: a side with its own tip". |
| A2 | The merge line: amber with overlaps, quiet and clean with when it was checked, none when not compared. | Unit "collision-alert: this checkout's branch …". |
| A3 | The pill: glyph, stage, items, key; none with nothing tracked. | Unit "ship-pill D2". |
| A4 | On real git: the line in amber, then clean once main is merged in; the band's pill once nothing needs you. | repos e2e (collision-alert block); `proof/home-merge-72.png`, `proof/band-110.png`. |
| A5 | Gates green; 0.6.0 with its Changes line (mod and Paseo). | The runs. |
| A6 | Thermo-nuclear review PASS on the branch's diff against main. | progress.md and the PR. |

## Changelog

- rev 1 (2026-10-18): created.
