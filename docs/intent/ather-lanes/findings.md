# Findings: ather-lanes

Discoveries that may change the intent. The worker adds entries; the orchestrator resolves them. F-1, F-3 and F-4 as revised by `review-rev1.md`; F-2 folded into D6 and F-7; F-5 to F-9 opened by that review.

## F-1 (2026-10-24, rev 1; revised by this review) | blocking: no | status: accepted (director, L-2: option A; decided by the parent's D1)

**Found:** as in rev 1, plus: the parent's D1 already makes Ather Lanes its own mod, and its A9 and A10 have Lanes start lanes and run the T0 merge, while Ather Board is read-only by its D2 and D6 (`docs/intent/ather-board/prompt.md:26`). A Lanes view in Board would have to leave Board's read-only rule within two revs.
**Options:**
- A (recommended): a new mod `ather-lanes` (D1), sharing Ather's modules through one shared sync script (`dev/sync-shared.mjs`).
- B: a Lanes view inside Ather Board, accepting that Board later merges PRs and starts lanes.
- C: fold it into Ather Automata (the parent's F-7 option B, already rejected there).
**Proposed amendment:** D1 as in rev 2.

## F-3 (2026-10-24, rev 1; revised by this review) | blocking: no | status: accepted (director, L-2: option A)

**Found:** `lanes.ps1 -Action Status -Json` has no ahead/behind, no last commit and no PR state. The parent already gives two of them a home: A6's `lane-ready.ps1` reports the behind-`main` count and the required checks (`prompt.md:52`). Measured: `for-each-ref` with `%(ahead-behind:origin/main) %(committerdate:unix)` takes 0.06 s for eight lane branches; one `gh pr list --search "head:a head:b"` takes 0.75 s and ORs the branches.
**Options:**
- A (recommended): the mod runs the one local `for-each-ref` per refresh and the one gh call per 5 minutes now, and drops both when `lane-ready.ps1` reports those fields.
- B: `for-each-ref` now; PR state waits for A6 (no network and no gh sign-in in the mod).
- C: both wait for A6; those columns are left out until then.
**Proposed amendment:** none for A (D2.3, D2.4, Constraints line four).

## F-4 (2026-10-24, rev 1; Found corrected by this review) | blocking: no | status: accepted (director, L-2: option A)

**Found:** the brief asks for progress in S2's `docs/intent/ather-lanes-mod/progress.md`, rows A7, A8 and A11, "on your own branch"; it forbids editing `docs/intent/` on the two foundations branches. An own S2 branch needs a pool lane (5-7 minutes, about 5 GB) for three table cells, and the foundations worker edits the same table on its branch, so the rows would conflict when both merge.
**Options:**
- A (recommended): this intent's `progress.md` is the record (A2 = parent A7; A3 + A4 = parent A8 in part; A5 + A6 = parent A11); the parent's orchestrator copies the verdicts, with a link to this PR, and marks A8 partial until rev 3.
- B: take a pool lane and update the parent's rows on an own S2 branch once #34883 and #34885 merge.
**Proposed amendment:** none for A.

## F-5 (2026-10-24, this review) | blocking: no | status: accepted (director, L-2: option A)

**Found:** on this PC no lane has a heartbeat that describes it: the lanes' workers are subagents of the `D:\s2` session, so Automata writes their heartbeat into `D:\s2`; `lane-overlap`'s is from a session that ended, on another branch; `_machine\heartbeats\` has one hand-written file. The skill asks long-running lanes to write `lanes.ps1 -Action Heartbeat` "now and then"; nobody does today.
**Options:**
- A (recommended): show "last moved": the branch tip's commit time from the `for-each-ref`, or a matching heartbeat when newer, with its source. No "live" verdict.
- B: A, and the director's worker brief asks each lane worker to run `lanes.ps1 -Action Heartbeat` at each step, so the heartbeat fills in.
- C: show nothing for liveness until Automata's own later release writes `_machine` heartbeats (parent D1).
**Proposed amendment:** none for A; for B a line in the S2 worker brief, outside this intent.

## F-6 (2026-10-24, this review) | blocking: no | status: accepted (director, L-2: option A)

**Found:** the parent's A3 report has no format yet (`feat/lane-overlap` has no `lane-overlap.ps1`), and the strain data file of parent A3' does not exist. Ather Board's Colliding already compares open intents' branches with `git merge-tree`; the A3 report adds binary, OFPA, shared-package and uncommitted classes on top.
**Options:**
- A (recommended): no overlap column and no toasts in rev 2; rev 3 adds them once `lane-overlap.ps1` lands with a JSON output. Parent A8 stays partial.
- B: agree a JSON shape now with the lane-overlap worker through the parent's orchestrator, and build the column against a fixture of it.
**Proposed amendment:** none for A (rev 2 as written). For the parent's orchestrator: compare the A3 report with Board's Colliding before a third overlap check is built.

## F-7 (2026-10-24, this review) | blocking: no | status: accepted (director, L-2: option A)

**Found:** `D:\s2` is 89 commits behind `origin/main` and lane work never updates it, so it gets the lane scripts late after the merge; until then the only copies are on branches other workers are changing.
**Options:**
- A (recommended): the `scriptsDir` setting, else the session's own checkout (D6); the director points the setting at a lane they trust until `D:\s2` is updated.
- B: the mod takes `lanes.ps1` and `_common.ps1` from `origin/main` (`git show`, object database) into its own data folder each time `origin/main` moves, so it only ever runs merged code. One git call per move; works only after #34885 merges.
- C: the S2 side copies the scripts into `_machine\bin\` when they change (an S2 change, later).
**Proposed amendment:** none for A.

## F-8 (2026-10-24, this review) | blocking: no | status: accepted (director, L-2: to the parent's orchestrator)

**Found:** what Ather Lanes needs from the S2 scripts, to drop its own workarounds later: (1) a read-only switch for `lanes.ps1 -Action Status` that moves no stale sidecar and creates no folder (`lanes.ps1:25, 61-70`, `_common.ps1:109-114`), for timed callers; (2) the heartbeat as an ISO time, not `'{0:n0} min'` (`lanes.ps1:89`); (3) slots in `-Json` with kind, purpose, end and old-style holders (today only `editor-slot.ps1 -Action Status` text, `:130-141`), and the slot counts, so free slots can be listed; (4) claims as a list, not a count. Also noted: `pool-lane.ps1` moves a worktree before it moves its sidecar (`:48-51`, `:67-69`), so a Status run in between files the pool sidecar as stale; harmless today.
**Proposed amendment:** none here; a finding in the parent once its `docs/intent/` is open again.

## F-9 (2026-10-24, this review) | blocking: no | status: accepted (director, L-2: option A)

**Found:** rev 1's D4 gives each row actions that hand the session a prompt (open the lane's intent, ask where it stands, open the PR). A session in `D:\s2` already shows every worktree's intent in Ather Automata, with "Where it stands" and its decisions routed to the session that tracks them.
**Options:**
- A (recommended): rev 2's D4: details in place, the PR as a link, the Register line to copy for an unregistered worktree; no prompts.
- B: rev 1's D4: the three actions as prompts handed to the session.
**Proposed amendment:** none for A.

## F-10 (2026-10-24, rev 3) | blocking: no | status: open (director)

**Found:** design.md's opened fold says each row has "at most one phrase (lime \"N decisions\", else the first amber reason, else nothing)", and its mockup shows one row with two ("3 decisions · checks failing"). D7 and A3 say "lime only for For you, amber only for A look's reasons", and A3's proof fails on "a colour out of place". The fold's text and D7 can't both hold.
**Options:**
- A (recommended, built): the opened fold's phrase is drawn in ink, one phrase a row (the decisions, else the first reason's short form). The colours then hold to D7 and A3 everywhere, and the phrase still says why.
- B: the fold's phrase takes its section's colour (lime for decisions, amber for a reason), and A3's colour check is read as "lime only on decisions, amber only on reasons".
- C: as B, with both phrases where a lane has decisions and a reason, as the mockup draws.
**Proposed amendment:** for A, design.md's fold paragraph reads "at most one phrase, in ink (\"N decisions\", else the first reason, else nothing)". For B or C, A3's colour sentence names the fold.
