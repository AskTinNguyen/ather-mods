# decide-in-place: Progress

Worker run 2026-10-08 on `intent/decide-in-place` (from origin/main 3315408, 0.1.9 → 0.2.0). Not committed; the coordinator commits. Round 2 (after the thermo-nuclear review's BLOCK) is below the table; the table reads as of round 2.

Evidence run (round 2, after every edit): `CLAUDE_CODE_TYPES=<2.1.287 claude-code.d.ts> S2_ROOT=E:/S2_ node dev/test-all.mjs` → exit 0; paseo shared modules in step, paseo/ather-automata tsc clean, mod type-check clean, unit `173/173 passed` (base 160), e2e `334/334 passed` (base 306). `claude plugin validate ather-automata` exit 0 on PATH claude 2.1.293 and on the 2.1.286 desktop exe, same warnings as 3315408. console.mjs 1550 lines (base 1556).

## Acceptance

| Id | Verdict | Evidence |
| --- | --- | --- |
| A1 | met | model.mjs `parseOptions` (pure): the `**Options:**` list, read from the last options heading, a one-word qualifier allowed (`**Options now:**`); the inline `(a) … (b) …` paragraph or list item only when it says Options or Recommendation; recommendation from `(recommended)`, a `Recommendation:` line, else the one option whose words say "recommended". `optionLabel`: the first clause, or the whole option cut when that clause is under three words or only sets the scene ("In the next C++ build", "After the import"). Unit on verbatim origin/main excerpts: fluid-snow-sand-look F-10 and F-8, quest-debug-panel F-1, sipher-so-montage-in-step F-63, ninetails-shape-drafting F-2 (lettered evidence, no options). e2e: a finding with no options opens with Explain, Type an answer, Open findings and no option buttons. |
| A2 | met | model.mjs `parseFindings`: one reader (`SELF_LINE`) for Status and Resolution lines, `Resolution (…):` included; a filled Resolution decides over the heading, closed unless it starts with open, pending, partly, not yet, tbd, `<` or `-` (`UNSETTLED`). Unit: quest-debug-panel F-1, auto-scale-uvs F-1 and boss-integration-checklist F2 closed; sipher-so-montage-in-step F-63 ("open; reported for the AIScalable owners"), world-building-tools F-2 ("open (Q3)") and F-8 ("partly addressed … stays open"), ninetails-shape-drafting F-2 ("<pending owner>") open. Live read of origin/main 9209256a5bc9 (68 intents, old model.mjs from 3315408 vs now): decisions waiting 11 → 6; Tin's 6 → 1; quest-debug-panel 4 → 0 (F-1, F-2 by their Resolution; F-4, F-8 by the coordinator's "not blocking" fix); boss-integration-checklist 1 → 0 (F2); of the 6 left, 3 carry parsed options. |
| A3 | met | decide.mjs `needsView` (pure: blocks, each row decided / opened / line, which rows open on a press, answers shown and folded, the typed field, the focus), drawn by rows.mjs `needsRows`. Unit "A3, A4: needsView lays out Needs you…". e2e screens at 72 and 110 columns and the desktop tree: whole question, `[ A: … (recommended) ]` primary, `[ B: … ]`, `x: Explain   t: Type an answer   Open findings ›`; "▸ zz-group · 2 decisions" folded, opened to one line each; one opened at a time; unique hotkeys; desktop: every answer a Button, no keys. |
| A4 | met | console.mjs `answerItem` (returns at once when the item was already sent), decide.mjs `findingAnswers`. e2e: an option pressed twice before the redraw sends one prompt; the exact D4 prompt; "✓ Decided: A · F-1 on zz-decide" in place, Needs you one fewer, the next opens; at +9 s "▸ 1 decided", unfolded "✓ F-1 on zz-decide: A". Answers live in `answerState` (this session only); drawing reads them, and `pruneDecided` drops one when the files are read again and its item no longer waits (after its 8 s). Unit "A4: …kept until the files read it resolved". |
| A5 | met | e2e: Explain hands the exact D5 prompt; the row stays open and still counts as waiting; the pane stays. |
| A6 | met | e2e (terminal): the typed field under the row, autofocus, "Your answer to F-2 on zz-group"; Enter hands the D4 prompt with the words. Both the field and the dialog's Other go through `answerTyped` (trim, empty guard) and `answers.typed(words)`. e2e (stand-in mobile surface, no Input): the "Answer" dialog (2-4 answers), Other decides. e2e: with the field open, Open findings → Back leaves it closed. |
| A7 | met | Search… opens `Input` `pick-search-field`; the dialog only without an Input; `/ather find` unchanged. e2e as in round 1. |
| A8 | met (D8 rev 2) | prompt.md rev 2: D8 covers decisions and "make them rules?"; away-window decisions are a Non-Goal follow-up. decide.mjs `ruleAnswers` (Make it a rule / No, leave it) and `rulePrompt` (the walk-through) end in one shared wording. e2e: the rule item opens with A/B, Explain, Type an answer; A hands the draft request (never a commit); Ask for the Editor keeps its press. |
| A9 | met | See the evidence run above; paseo copies in step (`npm run -s sync`); version 0.2.0 in plugin.json and the marketplace entry; README Changes line. |
| A10 | met | Thermo-nuclear review (S2 skill): round 1 BLOCK (a second Resolution parser closing real open findings, a NUL-template for typed answers, a possible double send, loose answer state written during render, row policy in the view, a duplicated rule prompt; parser picking superseded or evidence options), fixed in round 2; round 2 BLOCK on one regression (an unsettled Resolution reopening headings marked resolved: sipher-so-montage-in-step F-21-23), fixed by the coordinator (a closed heading beats an unsettled Resolution; UNSETTLED word-bounded; rule answers kept for the session); round 3 PASS on 2026-10-08. Coordinator re-ran: unit 174/174, e2e 334/334; validate exit 0 on 2.1.293 and 2.1.286; live origin/main: 6 decisions waiting team-wide, the director's one fluid-snow-sand-look F-10 with both options parsed. |

## Round 2 (thermo-nuclear BLOCK)

| Item | Verdict | Evidence |
| --- | --- | --- |
| 1 one resolution reader | done | `hasResolution` deleted; `SELF_LINE` + `UNSETTLED` in parseFindings, Resolution over the heading. Unit with the eight verbatim findings. Live A2 rerun: 11 → 6 (Tin 6 → 1). |
| 2 typed path | done | `typed: (words) => string` closures in `findingAnswers`/`ruleAnswers`; `WORDS`/`typedPrompt`, `Answers.findingId`/`slug` and `typeAnswer`'s dead `act` fallback deleted; one `answerTyped($, one, answers, words)`; onType/onTyped/onExplain are handed `answers`, no cast. |
| 3 double send | done | `answerItem` returns when `sent.has(one.id)`; e2e double press → one submit. |
| 4 answer state | done | `answerState` (`AnswerState`, `FRESH_ANSWERS` in decide.mjs), reset `{ ...FRESH_ANSWERS }` at session start; ui.close resets only the view (paneMode, Search's field, typing); no tuple resets; `decidedView` read-only, `pruneDecided` in readIntents; the away window's Home no longer drops answers; Open findings clears typing. |
| 5 policy out of the view | done | `needsView(items, open, state, opened, now, hasInput)` in decide.mjs; `needsRows` switches on the row state and `view.opens`; the Answering bag is `view` plus presses. Unit test. |
| 6 one rule wording | done | decide.mjs `draftRule`/`trapList` behind `rulePrompt` (home's walk-through) and `ruleAnswers`; unit checks all end in the same words. |
| 7 parser | done | last options heading with a qualifier; inline only with an Options/Recommendation anchor in its paragraph; scene-setting or short first clauses fall back to the whole text cut. Unit on fluid F-8, ninetails F-2, quest F-1. |
| 8 D8 | done | prompt.md rev 2 (D8, Non-Goals, Changelog). |

To keep console.mjs flat: `linkOf` moved to issues.mjs as `issueLink`, `cut` to model.mjs as `cutWords` (both pure).

## Findings

- F-1 (resolved by the coordinator between rounds): "not blocking" headings no longer count as blocking.
- F-2: away-window decisions answered in place are deferred (prompt.md rev 2 Non-Goals).
- F-3: with no drawing surface (`/ather` as one question), a decision still goes out as the walk-through prompt; only the pane answers in place.
- F-4: the unanchored inline form ("Which? (a) x; (b) y." without the words Options or Recommendation) is no longer read as options, per the round-2 rule; such a finding opens with Explain and Type an answer only.
