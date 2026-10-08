# Ather Automata: decide in place

- Rev: 2
- Status: completed
- Area: ather-automata
- Owner: Tin Nguyen
- Skill: `plugin-authoring`
- Branch: `intent/decide-in-place`
- Started: 2026-10-08

## Goal

A decision waiting on the person is answered where it is shown. Today a Needs you row ("Decide F-10 on fluid-snow-sand-look") hands the session a prompt that walks the person through it in a question dialog: two steps, and the options and recommendation are only visible after pressing. The findings already write the options and the recommendation in their text. Show them on the row as answer buttons (the recommended one primary and marked), with Explain and a typed answer, close the row in place once answered, and stop counting findings that already carry a resolution. Also give Search a real text field (panes have an `Input` element).

## Non-Goals

- A per-turn model call to predict options (the inbox mod does this; Ather parses what the findings already say).
- Deciding anything without the person's press; writing to findings.md from the mod (the session records the decision, as the intent skill's `decision` step says).
- Changing the S2 intent skill (its finding format is S2 PR #32881; this reads both formats either way).
- Answering away-window decisions in place (rev 2): the away review bundles every decision taken while away, the held actions and the end of the review in one walk-through, so per-decision Keep / Undo rows are a redesign of that review. Follow-up intent.

## Sources

- The petekp/inbox mod (MIT; read for ideas only, nothing copied): a selected question shows its answers as lettered buttons, the recommended one primary and labelled "(recommended)"; `t` opens an `Input` for your own words; `e: Explain` asks without deciding; a closed row shows ✓ and the outcome in place for 8 s, then folds under "▸ N Closed".
- Tin (2026-10-08): yes to Decide in place, then the tests-pass guard, and to standardising the finding format (S2 PR #32881).
- Real findings on origin/main use two formats: `**Options:**` then `- A (recommended): …` / `- B: …` lines (fluid-snow-sand-look F-10), and inline `Options: (a) … ; (b) … Recommendation: (a).` (quest-debug-panel F-1/F-2). quest-debug-panel F-1 and F-2 are headed "open" but carry `Resolution (orchestrator, 2026-10-05): accepted (a)`; Ather counts them as waiting (Home shows "4 decisions").

## Decisions

- D1 (options): a pure parser reads a finding's options and recommendation from both formats: `**Options:**` list items `- <Letter>[ (recommended)]: <text>`, and inline `(a) … (b) …` with `Recommendation: (a)` (or "recommended" inside an option). Each option: letter, short label (its first clause, cut to fit), full text. No options found: the row offers Explain and a typed answer only.
- D2 (resolved): a finding whose Resolution is filled (`**Resolution:** <text>` or a `Resolution (...)` line with text) is closed, whatever its heading says.
- D3 (row): in Needs you, the first open decision is expanded: its full question text, its options as buttons (`A: <label> (recommended)` primary, then the rest), then `Explain`, `Type an answer`, and `Open findings ›`. The other decisions take one line each; pressing one expands it (one at a time). An intent with several decisions keeps 0.1.5's grouping ("quest-debug-panel · 2 decisions") and expands to its decisions. Hotkeys only where unique on the screen (the e2e check); the desktop draws no keys, so every action is a button.
- D4 (answering): pressing an option hands the session "Decide <F-id> on <slug>: <Letter> — <full text>. Record it as the intent skill's decision step says (mark the finding, fill its Resolution, fold an accepted amendment into prompt.md with a Rev bump and a Decisions entry); do not ask me again." The row then shows "✓ Decided: <Letter>" in place for 8 seconds and moves to a folded "▸ N decided" under Needs you (this session's answers, newest first, kept until they read resolved in the files). A typed answer sends the same with the person's words as the choice.
- D5 (Explain): hands the session "Explain decision <F-id> on <slug>: what it is about, each option and what it means, and why the recommendation; do not decide or change anything." The row stays open.
- D6 (typed): `Type an answer` opens an `Input` under the row (autofocus, placeholder naming the decision); Enter sends it as in D4. Where the surface has no `Input` (mobile), fall back to the question dialog's typed "Other".
- D7 (Search): Everything open's Search opens an `Input` (live filtering as typed is optional; submit is enough), with the question dialog as the fallback where there is no `Input`; `/ather find <words>` stays.
- D8 (scope of decisions, rev 2): the same in-place answering covers every decision (call) and "make them rules?" (Make it a rule / No, leave it); items without options keep today's press. Away-window decisions are out of scope (Non-Goals).

## Acceptance

| Id | Item | Proof |
| --- | --- | --- |
| A1 | Options and the recommendation parsed from both formats; none when absent. | Unit on real excerpts (fluid-snow-sand-look F-10, quest-debug-panel F-1). |
| A2 | A finding with a filled Resolution is closed; quest-debug-panel's F-1/F-2 no longer count. | Unit; live read of origin/main: its decision count drops accordingly. |
| A3 | Needs you shows the first decision expanded with option buttons (recommended primary and marked), Explain, Type an answer, Open findings; others one line, expanding on press. | e2e screens (terminal 72/110, desktop tree), hotkey uniqueness passes. |
| A4 | Pressing an option hands the session the D4 prompt; the row shows "✓ Decided: X" in place, then folds into "▸ N decided". | e2e (time moved past 8 s). |
| A5 | Explain hands the D5 prompt and keeps the row. | e2e. |
| A6 | Type an answer opens an Input; submit hands the D4 prompt with the words; fallback to the dialog without Input. | e2e (both surfaces / a stand-in without Input). |
| A7 | Search uses an Input; the dialog only as fallback; /ather find unchanged. | e2e. |
| A8 | Other Needs you items with options answer in place (D8). | e2e for at least one. |
| A9 | No regressions; Paseo copies in sync; validate exit 0 on the PATH claude and the 2.1.286 desktop exe; version 0.2.0 with a Changes line. | `node dev/test-all.mjs` green; validators. |
| A10 | Thermo-nuclear review PASS (S2 skill). | Recorded in progress.md by the coordinator. |

## Changelog

- rev 1 (2026-10-08): created.
- rev 2 (2026-10-08): after the thermo-nuclear review's BLOCK, D8 is limited to decisions and "make them rules?"; answering away-window decisions in place moves to Non-Goals as a follow-up. A8 reads against D8 rev 2.
