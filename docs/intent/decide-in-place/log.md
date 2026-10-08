# decide-in-place: Log

## 2026-10-08, worker

- Baseline at 3315408: test-all exit 0, unit 160/160, e2e 306/306.
- model.mjs: `parseOptions`, `optionLabel`, `hasResolution`; `parseFindings` closes a finding whose Resolution is filled and returns `options` and `source` (the finding as written, capped at 6000 characters). First version of the Resolution regex let `\s*` cross lines and read the next heading as fluid-snow-sand-look F-10's resolution; fixed to `[ \t]*`.
- New pure module decide.mjs: the prompts (D4, D5, typed), `findingAnswers`, `ruleAnswers`, `openedDecision`, `decidedView`, `withDecided`, `decidedText`.
- home.mjs: call items carry `answers` (their finding's), rule items their own.
- rows.mjs: `needsRows` opens one decision with its answers (via `choiceRow`'s new `below`), shows "✓ Decided" in place and "▸ N decided"; `findingRows` (Open findings ›); `workGroups` takes `isFocusTaken`. MARK, `stageRow`, `masthead`, `summaryStrip`, `metaRow` moved here from console.mjs (pure drawing), so console.mjs stays at 1554 lines (base 1556).
- console.mjs: answering state, `answerItem`, `typeAnswer`, `answering`; the finding view; Search's field; fields reset on close.
- Stand-in engine: the mobile element table has no Input or Select; screen.mjs honours paddingLeft and lays a column beside a mark in the width left, and draws Markdown. Three e2e regexes that assumed unindented detail lines now allow the indent.
- e2e: search tests use the field (helper `searchField`), a mobile fallback test and two `/ather find` tests added; the "sent decision" test hands it over through `/ather`'s question; the terminal "pressing a Needs-you row" test now checks it opens in place; a fixture block (zz-decide, zz-group, a trap, a held Editor) covers A2-A8.
- Unit tests: 8 new (A1, A2, A3, A4, A5, A8); the Svg inventory test's order follows MARK's move.
- A2 live read: origin/main 9209256a5bc9, 11 → 8 decisions waiting (Tin 6 → 3).
- Version 0.2.0 (plugin.json, marketplace.json), README Changes line and maintainer map.
- Final run after every edit: test-all exit 0 (paseo in step, paseo tsc and mod type-check clean), unit 168/168, e2e 331/331; `claude plugin validate ather-automata` exit 0 on PATH 2.1.293 and on the 2.1.286 desktop exe (same warnings as 3315408). console.mjs 1554 lines.

## 2026-10-08, worker, round 2 (thermo-nuclear BLOCK)

- Kept the coordinator's "not blocking" change and its unit test.
- model.mjs: one Status/Resolution reader (`SELF_LINE`), a filled Resolution decides over the heading, closed unless it starts with open, pending, partly, not yet, tbd, `<` or `-`; `hasResolution` deleted. parseOptions: last options heading (qualifier allowed), inline options need an Options/Recommendation anchor, labels fall back to the whole text cut. `cutWords` moved here from console.mjs.
- decide.mjs: typed closures; `rulePrompt` + `ruleAnswers` share one wording; `AnswerState`, `FRESH_ANSWERS`, `pruneDecided`, read-only `decidedView`, pure `needsView`; `callId`. `WORDS`, `typedPrompt`, `findingId`, `slug` deleted.
- home.mjs: `callId`, `rulePrompt`. rows.mjs: `needsRows` draws `needsView`'s row states. issues.mjs: `issueLink` (was console.mjs `linkOf`).
- console.mjs: `answerState`; `answerItem` guards a double send; one `answerTyped`; pruning in readIntents; ui.close resets the view only; Open findings closes the typed field. 1550 lines.
- Tests: unit 173 (verbatim origin/main fixtures for F-63, world-building-tools F-2/F-8, auto-scale-uvs F-1, boss-integration-checklist F2, ninetails-shape-drafting F-2, fluid-snow-sand-look F-8); e2e 334 (double press, Back from Open findings).
- Live A2 (origin/main 9209256a5bc9): 11 → 6 decisions waiting; Tin's 6 → 1.
- prompt.md rev 2: D8 limited, away-window decisions under Non-Goals, Changelog.
- Final: test-all exit 0, unit 173/173, e2e 334/334; both validators exit 0, same warnings as 3315408.
