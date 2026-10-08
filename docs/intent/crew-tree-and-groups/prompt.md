# Ather Automata: who waits on whom, and a team list that groups

- Rev: 1
- Status: completed
- Area: ather-automata
- Owner: Tin Nguyen
- Skill: `plugin-authoring`
- Branch: `intent/crew-tree-and-groups`
- Started: 2026-10-08

## Goal

Two things the team now feels every day. (1) Workers start workers, and calls run for minutes, but the pane shows a flat list where any long build, PIE run or foreground Agent call reads as "waiting" (and the tick may toast "possibly a stuck permission prompt"); it should show, from facts only, which worker started which and what each one is waiting on. (2) The Everything open list has 44+ open intents (34 teammates'); it should group the teammates' list by person, area or stage with foldable heads and counts, and fold parked intents away, so a large list is digested in headings.

## Non-Goals

- Tabs (they duplicate the existing three groups: your intents, assigned issues, teammates'; and mix the owner and stage axes), digit hotkeys for tabs, an Area multi-select dialog (questions take 2-4 options), an `a` hotkey on the pick view.
- Waiting on a SendMessage reply (not derivable: fire-and-forget), another session's background tasks (not visible to this session), the Editor lock holder's session name in the waiting line, "waiting on a finished worker" (a foreground child's call returns when it ends).

## Sources

- Proposal and its fresh-eyes review (2026-10-08): the review verified the signals against `claude-code.d.ts` and the code — `tool.call`'s `next(e)` resolves when the tool finishes (also inside subagents via `e.agentId`), `recordTool` runs before `next` and only stamps `lastAt` at the start (watch.mjs, workers.mjs), so `crew.mjs`'s 90 s `isIdle` check misreads long calls; `agent.spawn` carries the parent; `classic.SubagentStop` has `background_tasks[]` (possibly session-wide: verify before use); question dialogs take 2-4 options; hotkeys taken: pick view rows 0-9, `s`, `o`, `r`; Home rows `abcdeghjkl`; intent view `a`.
- Tin (2026-10-08): "spawn another fresh eyes opus to review and critique to improve your proposal, then execute." Director calls taken as recommended: teammates grouped by Person when the list opens; parked folded by default.

## Decisions

- D1 (in-flight calls): the generic `tool.call` hook records, per loop (`e.agentId`, main loop included), the call in flight: tool, its `description` (or a short form of the command), start time, and for an Agent call the child's id once `agent.spawn` reports it; cleared when `next(e)` settles (success, deny or throw). A pure registry module owns it (no `$`).
- D2 (idle fix): "idle"/"waiting" for a worker means no call in flight and nothing heard for the idle threshold; a call in flight is never idle. The stuck-permission toast in the tick uses the same rule.
- D3 (tree): workers are drawn under the worker that started them (`parentId`), indented one level per depth; "started by X" is dropped when X is drawn above, kept as "started by X (finished)" when X is done and drawn elsewhere or not at all. A parent's finished children beyond 3 fold to "+N finished". Adopted workers (no tool history) show no in-flight line.
- D4 (waiting line, amber, facts only): `⏳ waiting on <child title>` while a foreground Agent call is in flight; `⏳ <description>` for a Bash or Monitor call in flight over 60 s, quoting its description verbatim (no resource inference); optional pack hook: when the in-flight command names the pack's Editor lock file, append the lock file's first line, cut. `⏸ paused · N background tasks` from `classic.SubagentStop` only if a test proves its list is that agent's, else not built (record the finding).
- D5 (stuck): `⚠ one call running N min` when a single call is in flight 25+ minutes.
- D6 (heading and words): "Workers · Running 2 · Waiting on 1" (waiting on = has a ⏳ line); the existing pending state (status not running/completed/failed, grey ○) is called "queued" in words, so "waiting" means one thing.
- D7 (grouping): in Everything open, a `Group: Person` button (pick view hotkey `g`, cycling Person → Area → Stage → None) sub-groups the Teammates' intents group into foldable sub-heads with counts (person: tidied owner name, team shown with its lead; area: the pack's areas; stage: the list stages). Default Person. A sub-group larger than 6 starts folded. The choice is remembered per person with `$.store` (through state.mjs); folds are not.
- D8 (parked): parked intents move to a folded "‖ Parked · N" sub-block at the end of each top group (yours, teammates'); a parked intent with no reason keeps its ⚠ on its row inside.
- D9 (search): while a search is active, group and sub-group heads show "x of y".

## Acceptance

| Id | Item | Proof |
| --- | --- | --- |
| A1 | In-flight calls recorded per loop and cleared on success, deny and throw; Agent calls linked to their child. | Unit on the registry; e2e with a foreground Agent call and a Bash call in flight (the stand-in can hold `next`). |
| A2 | A long call in flight is never shown idle, and never triggers the stuck-permission toast; a truly silent worker still does. | Unit + e2e (time moved past the threshold with a call in flight vs none). |
| A3 | Tree: children under their parent, "started by" only when the parent isn't drawn above (and "(finished)" when it's done), finished children past 3 fold to "+N finished". | e2e screens at 72 and 110 cols, desktop tree assertions. |
| A4 | Waiting lines from facts: `⏳ waiting on <child>`; `⏳ <description>` for Bash/Monitor past 60 s; pack lock line when the command names the lock file; no line for adopted workers. | Unit for the words; e2e. |
| A5 | `⚠ one call running N min` past 25 minutes. | Unit (time moved). |
| A6 | Heading "Workers · Running N · Waiting on M"; pending reads "queued". | e2e. |
| A7 | Group: Person/Area/Stage/None on the Teammates' group, foldable sub-heads with counts, default Person, >6 start folded, choice remembered across a reload; hotkey `g` on the pick view only; desktop shows it as a button. | Unit on grouping; e2e incl. a reload; hotkey uniqueness check passes. |
| A8 | Parked folded into "‖ Parked · N" at the end of each top group. | e2e. |
| A9 | Search shows "x of y" on heads. | e2e. |
| A10 | No regressions; Paseo copies in sync; `claude plugin validate` exit 0 on the PATH claude and the 2.1.286 desktop exe; version 0.1.9 with a Changes line. | `node dev/test-all.mjs` green; validators. |
| A11 | Thermo-nuclear review PASS (S2 skill). | Recorded in progress.md by the coordinator. |
