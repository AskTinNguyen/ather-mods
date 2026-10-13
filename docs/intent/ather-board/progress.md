# Progress: ather-board

- Worker: Claude Code session, 2026-10-13 (S1); second design pass, 2026-10-13 (S2)
- PR: (opened with this commit, draft)
- Current step: S2 done (F-1); handed over for the owner's go to commit and open the PR
- Next step: the owner tries /board in an S2 session; publish once `vesper-sites` is added; merge on the owner's go

## Acceptance

| Item | Verdict | Evidence |
| --- | --- | --- |
| A1 | met | Unit "one record per intent, read the way Ather reads it…", "stages: …", "a done intent carries no work flags…" (tests/board.test.mjs). Real git sandbox: "origin/main's intents with their first and last commit dates, through git" (createdAt from the folder's first commit, updatedAt from its last). Live, read-only against D:\s2 (origin/main 7351e2b53127): 144 records in 1.1-1.9 s. |
| A2 | met | Unit "flags: decisions waiting, stale after 5 days, ready to close, parked without a reason, no checklist", "data hygiene: …", "needs someone: …", "data hygiene is listed apart". Live D:\s2: 47 intents need someone, 11 in data hygiene. |
| A3 | met | Unit "done hidden unless shown…", "search words start words…", "sorts: …", "groups: …", "a rollup in one line", "the pickers list the areas and owners present". |
| A4 | met | Unit "every unmet item of every intent not done, by area or owner…". Live D:\s2: Tools 93, Enemies 40, Characters & Animation 24, Combat 20 open items. |
| A5 | met | Unit "opened by first commit and closed by last commit, per Monday-to-Sunday week…", "the summary line". |
| A6 | met | `claude plugin test ather-board` 7/7: "/board opens the pane: Triage lists the stale intent under its reason, on the terminal and the desktop", "the Table and Areas views; an area pressed opens the table filtered to it", "pressing an intent asks the session about it, read-only". |
| A7 | met | Unit "the views written into the page are the same functions…", "the browser script compiles", "one self-contained page…", "text that would end a script element is written so it cannot". Engine "/board open writes one self-contained page where the pack keeps local files, and opens it". The page from D:\s2 checked in the browser at 375, 800 and 1440 px, light and dark: every view draws, no console error, no horizontal scroll. After S2's design pass, the same at 375, 800, 1024 and 1440 px, light and dark (S2). |
| A8 | met | Unit "publishing hands the session one prompt…"; engine "/board publish writes the page and hands the session one prompt to publish it". README: adding `vesper-sites`. Not yet run against the real Sites MCP (needs the owner's sign-in). |
| A9 | met | `node dev/test-all.mjs` with CLAUDE_CODE_TYPES: sync check in step, type-check clean, unit 354/354 (Ather) and 32/32 (board, after S2), repos e2e 266/266. With S2_ROOT=D:/s2 the S2 e2e is 353/361; the 8 failures are Ather's own checks that name intents of the checkout (see S1), unchanged by this work. `claude plugin validate ather-board` passed and `claude plugin test ather-board` 7/7 (2.1.296). Thermo-nuclear review: round 1 BLOCK, round 2 PASS (below). README, marketplace entry. |
| A10 | met | assist.test.mjs "the person's open intents, grouped by what each needs from them…", "without a name, For you says how to give one", "the board's own suggestions…"; engine "/board opens on For you…" and "without a git user.name…". |
| A11 | met | assist.test.mjs "the owner's next action follows the worst flag…", "a teammate's intent… offers asking its owner", "every action's prompt…", "a decision answered in place uses Ather's own wording…", "one action over several intents…"; engine "pressing an intent opens it in place… hands the session one prompt". |
| A12 | met | assist.test.mjs request and parsing (good, unknown intents dropped, owner-only downgraded to show, broken); engine "/board opens on For you… Sonnet's brief with only real intents in it" (one brief per read) and "a suggestion pressed hands its action over". Live brief on D:\s2 (S3). |
| A13 | met | assist.test.mjs "an answer: its words and a cut of the board…"; engine "a question in the ask box comes back as an answer and a cut of the board, cleared with one press". |
| A14 | met | page.mjs carries the brief; client.js draws it at the top of Triage with links into the table; checked in the browser on the live page. |
| A15 | met | map.test.mjs (modules, sorting and its checks, keeping by fingerprint, mentions, Modules sections, graph, a stable layout); engine "Modules: … by Area and asks no model" and "a repository's own list is sorted by Sonnet once, kept in the store". Live map of D:\s2 (S3). |

## Steps

### S1 (2026-10-13)

- Read Ather's reader and parsing: `team.mjs` `readTeam` (origin/<base> through git, no index lock), `model.mjs` `parseIntent`, `worklist.mjs` `listStage`, `ownerName`, `rows.mjs` `workLine`. The board copies these (and what they import) into `ather-board/hooks/ather/` with `sync.mjs`; `dev/test-all.mjs` runs `sync.mjs --check`.
- Live survey of D:\s2 origin/main (2026-10-13): 142-144 intent folders; Status on 141 (69 active, 54 completed, 9 parked, about 8 written as sentences), Area on 134, Owner on 135, Issue on 29.
- The page runs views.mjs's own functions (written in by source), so the pane and the page cut the records the same way; a unit test runs the written copy against the module.
- The internal Sites MCP address is kept out of this public repository; the board names the server `vesper-sites`.
- S2 e2e (S2_ROOT=D:/s2): 353/361. The 8 failures are in Ather's own checks (a typed intent name in the Work question, a merge loss unreviewed), which name real intents of the checkout; this work changes no Ather module (the board only copies them). Clean main (2d6c889) in its own worktree against the same D:s2: the same 353/361, the same 8.

### S2 (2026-10-13): the second design pass (F-1)

- Audit and plan first, in findings.md F-1: Gestalt, "less, but better", and Ather's look as Ather Automata draws it. Then built as planned; no change to Ather's copies (`hooks/ather/**`).
- Ather's look on the page (page/board.css): near-black with Ather's ink #C9CCCC and quiet #8E918A; lime only on Needs someone (text in dark, a fill behind ink in light); amber for warnings (#9a5a00 as text on paper); every other colour gone (the blue accent, the per-stage colours, red, green and purple pills). Content capped at 1240 px on one left edge; "ATHER BOARD" over the title.
- One row anatomy on both surfaces, Ather's order: glyph, name and its warnings as amber text, the title under it, then Ather's own five-cell bar (`miniBarSvg`, now written into the page from worklist.mjs as `ageText` is), count, age, owner in fixed columns. On a phone owner, age and bar move under the name instead of disappearing. In the pane the columns line up across every group of a view.
- Common region at the group: one panel per group, rows divided by hairlines (not 140 bordered cards). Done rows quiet; an opened row and its details share one tint.
- Two levels, typed in views.mjs: a `label` section over its `groups` (top-level, spaced-out capitals, `isLoud` now there), and `intents` groups (bold title, quiet rollup). The pane's Table and Open items groups are bold, no longer spaced-out labels (team-truth D7).
- Triage grouped by reason, worst first (`REASONS`: Decisions waiting, Ready to close, No change for 5 days or more, Parked without a reason, No acceptance checklist); a row leaves out the warning its group says, except how many decisions wait. Live: 16 / 7 / 17 / 9.
- Rows warn with `WARNINGS` (decisions, stale, parked without a reason): ready to close and no checklist are what the glyph or column says. Labels: "stale" (the age has the days; was "no change for N days"), "parked, no reason" (Ather's words). `STALE_DAYS` moved to views.mjs for the reason's title.
- Board: a column only for a stage with intents (Plan and a hidden Done no longer stand empty); columns wrap to the width instead of running off it (four fit from 770 px); cards without the glyph their column says.
- Pulse: from the first week anything happened (no empty leading week); HTML bars so labels stay 12 px at any width; weeks as "Sep 28"; opened quiet, closed ink; stage bars ink, Done quiet.
- People and Areas: one panel, at most 880 px; zeros quiet, decisions and stale amber; names ink.
- Pane: the actions (Open the page, Publish) set apart from the view tabs by a quiet bar, both dim.
- Tests: board.test.mjs 32 (Triage by reason, Board without empty stages, WARNINGS, `miniBarSvg` as written into the page); plugin.test.ts keys and texts for Triage's groups.
- Gates: `node dev/test-all.mjs` (CLAUDE_CODE_TYPES 2.1.295 types): sync check, type-check clean, 354/354, board 32/32, repos e2e 266/266 (S2 e2e skipped: no S2_ROOT; no Ather module changed). `claude plugin validate .` passed and `claude plugin test .` 7/7 (2.1.296).

### S3 (2026-10-13): proactive board and the module map (rev 2, rev 3)

- For you (focus.mjs: `forYou`, `plainSuggestions`, `mergeSuggestions`, and `paneView`, the one place the pane's views are told apart); next action and every action's prompt (act.mjs; decisions through Ather's `decidePrompt`/`explainPrompt`; close and checklist through Ather's new `closePrompt`/`checklistPrompt` in model.mjs); the Sonnet brief and ask box (brief.mjs, strict parsing); the engine half (assist.mjs: one `latestJob` for the brief, ask and mapping, closures from index.mjs); the module list and mapping (modules.mjs, kept in `$.store` by fingerprint); the map (map.mjs, written into the page like views.mjs); intents naming each other (records.mjs `mentionsOf`). The pane opens on For you, rows open in place with actions, the ask box sits over every view, and there is a Modules view; the page shows the brief on Triage and has a Map.
- Live against D:\s2 (origin/main, 149 intents), the mod's own requests and parsers with Sonnet through the CLI: every intent mapped in three requests (tooling 79, VFX 36, quests 21, performance 19, combat 17, enemy abilities 17, environment levels 17, enemy AI 13, environment presets 10, bosses 10, main character locomotion 9, ...); 107 links between intents that name each other; the brief: "Tin, you have 5 decisions waiting on combat-impact-deform and anim-cache-assertion is fully met, so clear those first; then close the team's finished work." with 5 suggestions. The page's Map drawn in the browser: 17 hubs, 149 dots, no console error.
- `claude -p "/board open"` in D:\s2 did not reach the mod (print mode does not run a plugin's registered slash command); the interactive pane in an S2 session is left for the owner to try.
- Gates: `node dev/test-all.mjs` (CLAUDE_CODE_TYPES): sync checks in step (board and Paseo), type-check clean, 354/354, board 56/56, repos e2e 266/266; with S2_ROOT=D:/s2 the S2 e2e 353/361, the same 8 as clean main. `claude plugin validate` and `claude plugin test`: ather-board 12/12, ather-automata 8/8.

## Thermo-nuclear review

- Round 1 (2026-10-13): **BLOCK**. Critical: (1) the pane and the page each decided what every view shows (which records, which flags, the default look), already drifting; (2) `plural` and the stage glyphs and labels re-implemented beside Ather's. Also: a forced read dropped while a read ran, a failed checkout lookup cached forever, the page's copy of views.mjs tested for four functions only, a hand-kept sync list.
- Fixes: views.mjs owns the view model (`DEFAULT_LOOK`, `ATTENTION`, `HIDES_DONE`, `recordsFor`, `sectionsOf`, `pickLook`); pane.mjs and page/client.js only draw sections. `plural` from model.mjs; `STAGES` from worklist.mjs `STAGE_BLOCKS`/`STAGE_GLYPHS`. `refresh` reads once more when forced mid-read; `syncMain` re-reads only when the fetch moved origin; `laneOf` forgets a failed lookup. Every function views.mjs exports is run in node and as written into the page and compared, and every view's sections too. sync.mjs follows the entry modules' imports.
- Round 2: **PASS**, no critical finding open. Left open, with reasons:
  - The git and files adapters in index.mjs repeat console.mjs's: there is no shared home for engine adapters yet (a small upstream module the board syncs would be one; a change to ather-automata, so a follow-up).
  - ather-board/sync.mjs and paseo/ather-automata/server/sync.mjs are near-copies: a shared dev/sync-ather.mjs is a follow-up (paseo's also versions package.json).
  - An empty section title means "no heading" in both renderers, implied rather than typed.
- S2, round 1 (2026-10-13): **BLOCK**. Critical: a `label` section headed "the groups after it" by order alone, so the pane looked back over earlier sections and passed an `isUnderLabel` flag to place them (ad-hoc branching on a hidden data shape). Also: `WARNINGS` derived from flag kinds that happen to equal stage keys (magic); `ATTENTION` left as an export only `FLAG_ORDER` used.
- Fixes: a label carries its `groups` (typed `IntentGroup`), so both renderers draw a label and its groups directly and the flag is gone; `WARNINGS` an explicit list; `ATTENTION` folded into `FLAG_ORDER`.
- S2, round 2: **PASS**, no critical finding open. Left open, with reasons:
  - Triage's filter keeps a decisions warning in the Decisions waiting group by name (`kind === 'decisions'`): one line, commented, in the one place the groups are built; a field on `REASONS` for one entry would be more indirect.
  - The pane computes a row's cells twice (once for the view's shared columns, once to draw): pure and cheap, and keeps `groupLines` self-contained.
- Rev 2 and 3, round 3 (2026-10-13): **BLOCK**. Critical: (1) assist.mjs ran one async job pattern three times (abort, state, redraw, failure), already drifting; (2) duplicated helpers: `isMineFor` beside Ather's `isMine`, the close and checklist prompts beside Ather's `nextStep` (already different), JSON parsing twice. Also: the pane branching on view names again, the owner-only rule in four places, `/board open` waiting on Sonnet without a limit, rows built three times.
- Fixes: `latestJob` owns every job's run; `isMine`, `closePrompt(slug, prs, commit)` and `checklistPrompt(slug)` from Ather's model.mjs (extracted there; Ather's output unchanged; Paseo copy resynced); `jsonOf` shared; `paneView` and its extras table; `OWNER_ACTIONS`; `parseBrief` without casts; a 60 s cap on the page's wait; `rowOf`.
- Round 4: **PASS**, no critical finding open. Left open, with reasons:
  - This change edits ather-automata/hooks/model.mjs (a refactor: two prompts extracted, `nextStep` unchanged in what it says) and its Paseo copy; whether that needs an ather-automata version bump is the owner's call in the PR.
  - The 60 s timer in writePage stays scheduled after the page is written: harmless (it only resolves a promise nobody waits on).
  - Carried: the engine adapters repeat console.mjs's (no shared home yet); the two sync scripts.
- Pre-commit (2026-10-13, the owner's ask): the skill applied by the coordinator itself to the whole branch against main. No critical finding. Fixed before committing: the page's Triage drew its sections with its own copy of the generic drawing (now one drawing, the brief put in front); the comment on Ather's `closePrompt` named its consumer (now neutral); `plainSuggestions` re-typed the day's length (now `DAY_MS`) and cast its list (now built without one); `parseAnswer`'s view cast (now a find); two misplaced comments in act.mjs; an unused page global. Left open, with reasons: the page shell (page.mjs `escapeHtml`) and the browser script (`esc`) each escape HTML, in two runtimes, and putting a one-line HTML helper into the view model to share it would mix concerns; modules.mjs takes `MODEL` and `jsonOf` from brief.mjs, the module that talks to the model. Gates after: type-check clean, 354/354, board 56/56, repos e2e 266/266; ather-board 12/12, ather-automata 8/8; the page from D:\s2 draws every view, no console error.
