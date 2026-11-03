# auto-track: Progress

- Working under rev: 1
- Worker: auto-track worker (Claude Opus 5.5 subagent of the orchestrator session); feature commit 92af145
- Current step: none (stopped for the orchestrator)
- Next step: the orchestrator opens the PR on Hai's go (the brief said: no push, no PR); A11's review is recorded below
- PR: none yet (branch `intent/auto-track`, not pushed)

## Acceptance

<!-- One row per acceptance id in prompt.md, same order. Verdict is exactly met or open; met needs evidence (commit / command and its result line). -->

| Id | Verdict | Evidence |
| --- | --- | --- |
| A1 | met | S1. e2e (repos) "auto-track A1: a worker's write into alpha's progress.md tracks alpha for the session, and says how to stop it"; e2e (S2) "a worker's write into any file of an intent's folder tracks it for the session, and says so". Mutation M1 (re-adding `e.agentId === undefined`) fails both repos checks A1 and A4. |
| A2 | met | S1. Unit "auto-track A2" (2 tests: `intentFolderOf` on any file, files beside the folders do not; work with nothing tracked takes it); e2e (repos) "auto-track A2 and A4" (`proof/a1.txt`). Mutation M2 (prompt/log only) fails 3 unit tests. |
| A3 | met | S1, S2. Unit "auto-track A3" (6 positive forms incl. heredoc, PowerShell here-string, `cd x &&`, `git -C`; 9 negative incl. `-F` then `git tag -m`, `commit-tree`, `echo "git commit …"`); e2e (repos) "auto-track A3" ×2 (no folder / failed commit track nothing; a commit in `../web` tracks web's login); Paseo e2e "an intent(feat-y) commit tracks feat-y for the agent". Mutations M3a (hook removed) and M3b (parser returns null) each fail. |
| A4 | met | S1. Unit "auto-track A4" (3 tests: 29 min keeps, work on the tracked one restarts its 30 min, 31 min takes; a deliberate track counts as work and stays deliberate; new intent takes at once, never while away, an old pin counts as idle); e2e (repos) "auto-track A4", (S2) "work on another intent within 30 min does not switch" and "capturing a new intent … switches the pin to it". Mutation M4 fails 3 unit tests. |
| A5 | met | S1. Unit "auto-track A5" (a live peer keeps it, tracking on purpose still works, an ended peer does not; a closed intent is never taken); e2e (repos) "auto-track A5" and "… tracking it on purpose still works". Mutations M5a (peers ignored) and M5b (closed not blocked) each fail. |
| A6 | met | S1. Unit "auto-track A6" (auto pin goes, no stop, reopened is taken again; a deliberate pin stays; nothing while away runs); e2e (repos) "auto-track A6" ×2 (deliberate stays; auto pin let go at the next tick, toast, heartbeat `intent: null`, no stop); Paseo e2e "once feat-y is completed, the next tick lets it go". Mutations M6a (tick does not untrack) and M6b (deliberate pins dropped too) each fail. |
| A7 | met | S1. Unit "auto-track A7" (2 tests: no re-pin, the new-intent exception included; pinMeta moves with /clear and is pruned); existing unit "a write does not track again an intent this session stopped tracking" and "a stop is kept per checkout"; e2e (repos) "auto-track A7" ×2, (S2) "after /ather untrack, a write into that intent does not track it again". Mutation M7 fails 3 unit tests. |
| A8 | met | S2. Every gate as on the base, except the named changes: run.mjs's track-guard A3 block replaced by the auto-track block (S2 e2e); `ather.test.mjs`'s "auto-track (A3) reads only the orchestrator's files" removed (replaced by autotrack.test.mjs A2), its two `onlyIfNone` calls now `autoTrack`. Looking-never-tracks, untrack and second-session checks unchanged and green. |
| A9 | met | S1, S2. `paseo/ather-automata/server/watch.ts`: writes and commits through `state.autoTrack`, `untrackClosed` in the tick; two Limits lines (workers' writes not seen; a full prompt.md write counts as new). Paseo type-check clean, Paseo e2e 11/11 (base 9/9). |
| A10 | met | S2. 0.7.0 in plugin.json and marketplace.json, `npm run sync` (package.json, package-lock.json 0.6.8 -> 0.7.0), Changes line. `node dev/check-release.mjs`: "ok ather-automata 0.6.8 -> 0.7.0 … Changes line found … release check: passed with 3 notes" (board and lanes: only their copies moved, no release). origin/main is 0.6.8; open PRs: #62 claims 0.4.0 (stale), #67 and #84 claim none. `claude plugin validate --strict` . / ather-automata / ather-board / ather-lanes: "✔ Validation passed"; `claude plugin test` ather-automata 8 pass 0 fail, ather-board 12/0, ather-lanes 18/0. |
| A11 | met | S3. Thermo-nuclear review rounds 1-3, `Verdict: pass` on round 3; mutation check 10/10 caught. |

## Steps

<!-- S<n> (rev <r>, <YYYY-MM-DD>): <what was done>. Evidence: <commit / command and result line / PR>. Acceptance: <A-ids moved>. -->

- S1 (rev 1, 2026-11-03): built auto-track on `intent/auto-track` from origin/main 1f48948 (0.6.8).
  - `hooks/autotrack.mjs` (new, pure): `AUTO_SWITCH_MS` (30 min), `PinMeta` ({ at, isAuto }), `mayTake`, the two toast texts.
  - `hooks/state.mjs`: new key `pinMeta:<sid>` (in LANE_KEYS: moves with /clear; prune finds it through `LANE_KEY`, now built from LANE_KEYS instead of a second hand-written list; untrack and auto-untrack remove it). `track` is the deliberate path only (lifts stops, "Continue …"); new `autoTrack(io, root, slug, isNew)` (stop → same intent notes its time → closed or tracked elsewhere blocks → `mayTake`); new `untrackClosed` (auto pins only, not while away runs, no stop). Shared `targetOf`, `stopsTarget`, `setPin`, `isClosedAt`, `isTakenElsewhere`. To stay under 1,000 lines, `rungOfGates`, `NO_GATE` and `EVIDENCE_TTL_MS` moved verbatim to `model.mjs`; state.mjs 969 -> 999.
  - `hooks/model.mjs`: `statusOf` (parseIntent uses it) and `isClosedStatus`.
  - `hooks/changes.mjs`: `intentFolderOf` (any file, with the root before docs/intent) replaces `orchestrationFileOf`; `intentFileOf` filters it.
  - `hooks/shell.mjs`: `commitIntentOf` (the commit's own segment, first message; heredoc first line; `commit-tree` excluded), one `HEREDOC` regex shared with `withoutHeredocs`.
  - `hooks/watch.mjs`: any Write/Edit/MultiEdit into an intent folder, main thread or worker, calls `workedOn` after it ran (a main-thread new prompt.md is `isNew`); `afterShell` does the same for a commit that did not fail, in the checkout it ran in; the tick runs `untrackClosed` before the heartbeat. Toasts per D8. watch.mjs 826 -> 838. console.mjs untouched.
  - Paseo (D9): `server/watch.ts` ported; Limits lines in `paseo/ather-automata/README.md`.
  - Tests: `tests/autotrack.test.mjs` (13 tests, one describe per row A2-A7); e2e blocks in `dev/e2e/repos.mjs` (12 checks), `dev/e2e/run.mjs` (track-guard A3 block rewritten on its own sandbox intents: S2's box-scale-tool is completed and fluid-snow-sand-look parked now), `dev/e2e/paseo.mts` (2 checks).
  - Syncs: `node dev/sync-shared.mjs ather-board` / `ather-lanes` (model.mjs, shell.mjs copies), `npm run sync` in paseo/ather-automata.
- S2 (rev 1, 2026-11-03): gates. Same machine back to back, Node 22.23.2 (the PATH Node 22.14 lacks `module.registerHooks`, which the Paseo e2e needs), TEMP/TMP/TMPDIR = C:/Users/<user>/AppData/Local/Temp, `S2_ROOT` = the shared S2 checkout, `CLAUDE_CODE_TYPES` = the engine's index.d.ts, `npm ci` in both paseo plugins. Base = a detached worktree of origin/main 1f48948.

  | Gate | Base (origin/main 1f48948) | After (this branch) |
  | --- | --- | --- |
  | copies | in step | in step |
  | Paseo type-check (both) | clean | clean |
  | Paseo e2e | 9/9 | 11/11 |
  | type-check (engine types) | clean | clean |
  | unit | 405/405 | 417/417 |
  | board unit | 73/73 | 73/73 |
  | lanes unit | 40/40 | 40/40 |
  | dev tests | 4/4 | 4/4 |
  | repos e2e | 334/334 | 346/346 |
  | board e2e | 18/18 | 18/18 |
  | lanes contract | 15/15 | 15/15 |
  | S2 e2e | 347/361 | 346/360 |

  The 14 S2 FAILs on the base are main's (the S2 checkout's intents moved on: "fluid" now matches 6 intents, the Dodge issue list, and so on). The branch's 14 S2 FAILs are the same 14 by name (compared by a script; none only on either side); the branch has one check fewer because the rewritten auto-track block in run.mjs has one expect fewer than track-guard's A3 block. The first branch S2 run stopped on a test bug of mine (an Edit of a progress.md that did not exist in the sandbox); fixed to a Write, rerun.
  Also: `node dev/check-size.mjs`: "size check: passed (20 code files changed)" (notes: dev/e2e/run.mjs and repos.mjs grow, not held). `node dev/check-release.mjs`: passed with 3 notes. `claude plugin validate --strict` on ., ather-automata, ather-board, ather-lanes: passed. `claude plugin test`: ather-automata 8/0, ather-board 12/0, ather-lanes 18/0.
- S3 (rev 1, 2026-11-03): thermo-nuclear review (a fresh Claude Opus 5.5 subagent on the branch's diff against origin/main, copies excluded, with the repo checks of the pr skill) and the mutation check.
  - Round 1, `Verdict: block`. C1: `commitIntentOf` read the message off the raw command after the first `commit` (a later `git tag -m`, `commit-tree`, an echoed string all matched). Fixed: one parse of the commit's own segment, heredoc as its first line, `commit(?=\s|$)`; the probes are negative unit cases. C2: stop/same/blocked order lived in both `autoMove` and its caller. Fixed: `track` (deliberate) and `autoTrack` split, order once in `autoTrack`, `mayTake` a boolean, `refresh` and the `isAuto`/`onlyIfNone` options gone. C3: three regexes parsed intent paths. Fixed: `intentFolderOf` the only parser (with `root`), `intentFileOf` and `intentRootOf` read it. Notes taken: isClosedStatus to model.mjs, prune's key list from LANE_KEYS, a Paseo Limits line for the prompt.md shortcut, a comment on slug-only peers. Not taken, with reason: Paseo's `laneOf` (a narrower cast of `state.lane`) would need a cast for `folderLane`.
  - Round 2, `Verdict: pass`, no critical finding; notes: write the pin and its meta one after the other (done), say the `<kind>:<sid>` shape LANE_KEY needs (done), state.mjs headroom, PinMeta's home.
  - Round 3 (after those two notes), `Verdict: pass`, no new finding.
  - Mutation check (each piece removed once, its gate run): M1 worker writes ignored -> repos 344/346; M2 prompt/log only -> unit 414/417; M3a commit hook removed -> repos 344/346; M3b parser null -> unit 416/417; M4 no 30-min wait -> unit 414/417; M5a peers ignored -> unit 416/417; M5b closed not blocked -> unit 416/417; M6a tick does not untrack -> repos 345/346; M6b deliberate pins dropped -> unit 416/417; M7 stops ignored -> unit 414/417. 10/10 caught; files restored after each.

## Open limits

- state.mjs is at 999 lines: its next change must move code out first (the tracking helpers `targetOf` … `isTakenElsewhere` are the natural group).
- `PinMeta` is typed in autotrack.mjs though state.mjs stores it (review note, left).
- A heartbeat names a slug only: a peer tracking the same slug in another checkout also keeps auto-track off it (the safe side).
- `-F <file>` commit messages are not read; Paseo does not see a worker's writes, and counts any full prompt.md write as a new intent (Limits lines).
