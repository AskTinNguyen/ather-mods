# Ather Lanes: Review of rev 1

- Reviewer: independent adversarial pass (Opus), 2026-10-24, read-only. Read: this intent's `prompt.md`, `findings.md`, `log.md`, `progress.md`; the handoff brief `ather-lanes-mod-brief.md`; the parent `docs/intent/ather-lanes-mod/` rev 3 (`prompt.md`, `findings.md`, `progress.md`, `review-rev1.md`, `evidence-a2-2026-10-24.md`) and the grandparent `agent-swarm-single-pc/` rev 8 (`prompt.md`, `progress.md`, `evidence-a0-2026-10-24.md`) in `D:\lanes\lanes-foundations`; the lane scripts there (`SKILL.md`, `lanes.ps1`, `_common.ps1`, `editor-slot.ps1`, `pool-lane.ps1`, `data/slot-counts.json`); the live files under `D:\lanes\_machine\` and `D:\s2\.git\worktrees\`; Ather Automata 0.6.6 (`README.md`, `state.mjs`, `model.mjs`, `worklist.mjs`, `rows.mjs`, `prs.mjs`, `workspace.mjs`, `packs/unreal.mjs`), Ather Board 0.3.0 (`README.md`, `sync.mjs`, `hooks/index.mjs`, its intent), `paseo/ather-automata/server/sync.mjs`, `dev/test-all.mjs`, `dev/e2e/engine.mjs`, `.claude-plugin/marketplace.json`; the thermo-nuclear review skill's Approval Bar; the `plugin-authoring` skill and its engine types (2.1.308).
- Commands run (read-only): `lanes.ps1 -Action Status -Json -Repo D:\s2` four times (no stale sidecar existed, so it moved nothing), PowerShell start-up timings, `git for-each-ref` with `%(ahead-behind:origin/main)` in `D:\s2` (`GIT_OPTIONAL_LOCKS=0`), two `gh pr list -R sipherxyz/s2 --search` calls from the scratchpad, `Get-CimInstance Win32_Process`, `gh repo view`.
- Status of this file: review input for rev 2. Not an instruction source; the orchestrator folds what the director accepts into `prompt.md`.

## Verdict

Needs rev 2. The shape is right (a separate, read-only mod over `lanes.ps1 -Action Status -Json` and the `_machine` files), but rev 1 promises "writes nothing" while it runs a script that writes, measures its cost in a way that cannot attribute or catch its own processes, builds two columns against files that do not exist yet, picks a heartbeat source that is empty for the lanes on this PC, and invites four thermo-nuclear blockers in its design.

## Critique

Most severe first. Each: what is wrong, the evidence, why it matters, the fix.

### C1. `lanes.ps1 -Action Status` writes, and the mod would run it on a timer

- **Wrong:** Non-Goals line 2 and Constraints line 3 say the mod writes nothing of the lanes, and A2's proof is a `grep` for write calls in `ather-lanes/`. Status itself writes: it moves every sidecar whose worktree it does not see to `_machine\lanes-stale\` (`lanes.ps1:61-70`), and it creates `_machine`, `_machine\lanes` and `_machine\heartbeats` when they are missing (`lanes.ps1:25`, `_common.ps1:109-114` `Get-MachineDir`).
- **Evidence of a real window:** `pool-lane.ps1` Fill runs `git worktree move` and only then removes and rewrites the sidecar (`:48-51`); Take does the same (`:67-69`) and writes the new lane's sidecar only at the end, after `git lfs checkout` and the index patch, about 5 minutes later (`:82`). A Status run in the first window moves the pool sidecar aside; one in the second shows the new lane as unregistered. Both are benign today, but at a 30 s cadence (D3) the mod becomes the machine's most frequent sidecar mover.
- **Why it matters:** the grep proof is hollow (the writes happen through the script). On any machine with an S2 checkout and no lanes (a teammate's PC), opening `/lanes` would create `<parent>\lanes\_machine\...` folders.
- **Fix:** say it plainly: the only write the mod causes is Status' own stale-sidecar move, named in the README. Before spawning anything, the mod checks that the machine folder exists (one `fs.exists`), so Status never creates it. Ask the S2 side for a read-only switch (F-8).

### C2. The cost proof (A4) can neither attribute nor catch the mod's processes

- **Wrong:** "the machine's `git.exe` count never exceeds the baseline before the mod plus one", sampled each second.
- **Evidence:** at 20:17 the machine had eight `git fsmonitor--daemon` processes and two `git lfs checkout` processes in `D:\lanes\lane-overlap` started by another agent (`Get-CimInstance Win32_Process`). The baseline moves with other agents' work. Measured here: the mod's `for-each-ref` lasts about 60 ms, Status about 0.42 s, gh about 0.75 s: a 1 s sample misses most of them. "gh at most twice" at a 5-minute cadence over 10 minutes is three runs (0, 5, 10 min). A4 never checks the pane closed, or session start, which is where "nothing runs while the pane is closed" (D3) can fail.
- **Why it matters:** the proof fails for other agents' work and passes while missing the mod's own calls. It is the parent A8's only process proof.
- **Fix:** use the parent's own A2 method: `GIT_TRACE2_EVENT` set for a session with Ather Lanes alone loaded. The trace gives every git argv with start and exit times, so concurrency is exact; Status' calls are known by `cmd_ancestry` (through `powershell.exe`), the mod's one direct call by its argv. Count PowerShell and gh from the mod's own debug log of each spawn. Add a closed-pane window and the time before the pane opens: no process at all.

### C3. The overlap column and the toasts read files that do not exist

- **Wrong:** A3 asks for a screenshot "with a staged overlap (from a fixture A3 report until the real one lands)"; D5 plans toasts from the A3 report and the parent's strain data file.
- **Evidence:** branch `feat/lane-overlap` (lane `D:\lanes\lane-overlap`, head `c6a829bbff36`) has no `lane-overlap.ps1` and no report format: its last three commits are the foundations commits, and `scripts/` holds the same nine files as `lanes-foundations`. The strain thresholds file (parent A3') does not exist either.
- **Why it matters:** a fixture report means the mod invents A3's output contract, which the lane-overlap worker then has to match or the mod gets rewritten. An empty column that "says so" costs a column at 72 columns for nothing.
- **Fix:** take overlaps and toasts out of this rev entirely (no column, no toast code). Map parent A8 as partial in `progress.md`. Rev 3 adds them once `lane-overlap.ps1` lands with a JSON output (F-6).

### C4. The heartbeat column will be empty or wrong for the lanes on this PC

- **Evidence (live, 20:16):** Automata session heartbeats exist only in `D:\s2\Saved\AtherAutomata\lanes\` (the director's own session: intent `ather-lanes-mod`, branch `main`) and in `D:\lanes\lane-overlap\...` (`hasEnded: true`, from 17:00, branch `lane/a14proof`, while the lane is now on `feat/lane-overlap`). `_machine\heartbeats\` holds one file, `lanes-foundations`, written by hand for "A0 proof", 33 minutes old. `xiaobai-inactive` (the Editor lane) has none. The lanes' workers run as subagents of the `D:\s2` session, so Automata writes their heartbeat into `D:\s2`, not into the lane.
- **Also wrong:** "the freshest one wins" merges two unlike things: Automata's (`updatedAt` ms, `hasEnded`, live at 10 minutes, `state.mjs:641, 726`) and `_machine`'s (`at` ISO, `working|waiting|idle|done`). Status' own `heartbeat` field is a rounded, culture-formatted string (`"33 min"`, `lanes.ps1:89`). The parent's "live" is 30 minutes (parent A5); Automata's is 10. Picking one is a policy the mod does not own.
- **Fix:** add the branch tip's commit time to the same `for-each-ref` (`%(committerdate:unix)`), so every row has a "last commit" age at no extra cost. Show a heartbeat only when it matches the row (Automata's: same branch; `_machine`'s: same lane name), with its source and age, and the newest of the two as "last moved". No "live" verdict in this rev. Whether workers should be briefed to write `_machine` heartbeats is the director's (F-5).

### C5. The design invites four presumptive blockers of the thermo-nuclear Approval Bar

- **Duplicated helper.** D1 adds `ather-lanes/sync.mjs` "exactly as `ather-board/sync.mjs` does". The repository already has two such scripts (`ather-board/sync.mjs`, 58 lines, its target and `ENTRIES` hard-coded at `:12, :16`; `paseo/ather-automata/server/sync.mjs`). A third copy is the blocker "duplicates an existing helper". Fix: move Board's to `dev/sync-shared.mjs <mod>`, each mod naming its entry modules; `dev/test-all.mjs` checks Board and Lanes with it; Board's behaviour and tests unchanged.
- **Lane policy re-implemented.** A1's kinds ("lane 0, lane, pool ready, pool building, unregistered") re-classify what Status already says, mix the lane kind with the sidecar state, and drop `harness worktree (.claude\worktrees)`, `other worktree` and `missing` (`lanes.ps1:84-85, 91-92`). Fix: take Status' `kind` and `sidecar` verbatim; A1 fails if a record's kind differs from Status'.
- **A second "waiting decision" rule.** A1 counts "open findings that have `**Options:**`". Automata's rule (`model.mjs:482` `directorCalls`; README 0.3.5: an Options list, a decider in the status, or words naming the director's call) is different, and a `D:\s2` session already shows every worktree's intent decisions in Needs you (README "One repository, its worktrees"; 0.6.5). Two panes would count differently. Fix: `parseIntent` and `directorCalls` through the shared sync.
- **A second slot parser and stale rule.** "Kind, purpose and time left" and "an expired hold" need the slot file's key lines and `editor-slot.ps1`'s 30-minute rule (`editor-slot.ps1:50`). `parseEditorLock` already reads the first line ("held by <lane> until HH:MM; ... kind <k>; slot <id>") into holder, end and `isStale` by the same rule (`packs/unreal.mjs:58-72`), as the parent's A0 evidence shows. Fix: `parseEditorLock` plus the kind from the first line's `kind <k>` (a perf capture writes `kind perf` into `full-1`, `light-*` and `build-1`, so the file name alone is wrong); no purpose in this rev.
- **Computed fields with a canonical home coming.** The parent puts behind-`main` and PR checks in A6 `lane-ready.ps1` (parent `prompt.md:52`); the mod's `for-each-ref` and gh calls are temporary copies of those fields, and F-3's drop condition should name A6, not a later `Status -Json`.

### C6. The coexistence proof (A5) is a dodge in the form written

- **Wrong:** "at most one toast per mod per event (Lanes: none in rev 1)" is true because Lanes hooks nothing; "neither mod reads or writes the other's store" is enforced by the engine (`$.store` is "this plugin's own key-value store", engine types). Neither can fail. A3's screenshots have no failure condition either.
- **Why it matters:** parent A11 exists for the real risks: doubled toasts, a slowed `Edit`, two panes that cannot both draw, and the two mods disagreeing on the same fact (who holds the Editor).
- **Fix:** prove the construction instead of claiming a result: `claude plugin validate ather-lanes` and a test show no hook on `tool.call`, `tool.result`, `prompt.*`, `turn.*` or `AbovePrompt`. Add checks that can fail: both panes open and draw in one session; a unit test that for one slot file and the pointer `editor-slot.ps1 Sync` writes from it, Lanes' holder and end equal Automata's `parseEditorLock` reading of the pointer. A3: the live row set equals Status' lane names at the same moment, compared by a script.

### C7. Data sources: several facts in D2 are off or missing

- Status takes 0.40-0.44 s wall here, PowerShell start-up 0.12-0.15 s (five runs); not "about 0.65 s, mostly PowerShell start-up". Most of it is the script and its three git calls (`rev-parse`, `worktree list` twice; parent `evidence-a2`), so Constraints line 1 ("the only git process is D2's one `for-each-ref`") is wrong.
- `%(ahead-behind:origin/main)` works across worktrees as claimed (git 2.53, refs are shared): 0.10 s for all 44 local branches of `D:\s2`, 0.06 s for the eight lane branches named. Name the lane branches; `refs/heads/` also walks 36 unrelated ones (backups, old `thermo/*`, `feat/arch-pcg-*`). A detached worktree has no ref and gets no count. Lane 0's `main` is 89 behind `origin/main` today: the row should show it.
- "The pane says its age": the mod never fetches, and Automata fetches with `--no-write-fetch-head` (`team.mjs:41`), so the only honest source is the last line of `.git/logs/refs/remotes/origin/main` (19:04 today): "origin/main as of 19:04".
- gh: several `head:` terms in one `--search` are OR'd (checked: `head:feat/agent-lanes-foundations head:feat/agent-lanes-slots-status` returned both PRs, 0.75 s). Leave out lane 0 (`head:main` matches every fork's `main`) and the pool branches. Run it with `-R <owner/repo>` (from lane 0's `.git/config`, a file read) from a folder outside any checkout, so gh runs no git of its own. The search index can lag a just-opened PR by a minute; the row says "as of".
- Status' JSON: `heartbeat` is a string (above), `slotHeld` a comma-joined string, `claims` a count, and `machineDir` is in the output: the mod should take the machine folder from there instead of computing it (one less path rule in the mod).
- Do not read `.git\worktrees\` directly as a shortcut: the admin folder names do not match the lanes (`_poolbuild-01` is `lanes-foundations`, `_poolbuild-011` is `xiaobai-inactive`, `a14proof` is `lane-overlap`).

### C8. D6's script location fails after the merge, and the setting runs code under edit

- `D:\s2` is at `637bee97c57c`, 89 commits behind `origin/main` (`for-each-ref`: `main 0 89`), and lane work never rewrites `D:\s2` (grandparent Constraints, `prompt.md:80`). After #34883 and #34885 merge, "look in lane 0's checkout" still finds nothing until the director updates `D:\s2`.
- Meanwhile `scriptsDir` points at `lanes-foundations`, a branch another worker is changing (`c6a829bbff36` landed at 19:44 today), so the mod would run in-progress PowerShell on a timer.
- Fix: the setting first, then the session's own checkout (a lane taken from the pool after the merge has them); F-7 for the longer-term source.

### C9. The repository is public; A1's fixtures would publish the director's machine

- `AskTinNguyen/ather-mods` is `PUBLIC` (`gh repo view`). A1 says "fixtures copied from this PC's real files"; those carry lane names, branches (`fix/xiaobai-inactive-hide`), issue numbers (`issue-34173`), paths and the host name (`TINHOMEPC`, in every sidecar and heartbeat). The draft's own last Constraint says these are the director's. The two lines contradict.
- Fix: fixtures keep the shape with every name replaced. Contract drift (Status' JSON is on an unmerged branch and may change in review) is caught by a contract test that runs the real `lanes.ps1 -Action Status -Json -MachineDir <scratch>` on a scratch repository with two worktrees (Windows only, skipped elsewhere with a message), not by copying live output.

### C10. Over-built for a first slice

- D4's actions (open the lane's intent, ask where it stands, open the PR) hand prompts that Automata already serves for every worktree's intent in a `D:\s2` session (intent view with "Where it stands", README 0.2.8; decisions routed to the session that tracks them, 0.6.5). Cut to details in place, a PR link, and for an unregistered lane the `lanes.ps1 -Action Register` line to copy (that lane is invisible to intent and tier today: `lane-overlap` is unregistered). F-9.
- D5 designs toasts for two sources that do not exist (C3).
- A4 asks for "one Editor running": staging one takes the only full slot (`slot-counts.json`: full 1) that the Editor lane `xiaobai-inactive` needs (sidecar `slot: full`). With the trace (C2) the Editor does not change what is measured. Run during normal work.
- A2's proof takes a real slot on a machine where other agents need them. Use a scratch machine folder: `editor-slot.ps1 -MachineDir <scratch> -Isolated` and a `machineDir` setting passed to Status as `-MachineDir`.

### C11. Fidelity to the brief and the parent

- Scope matches the brief (parent A7, A8, A11; A5, A6, A9, A10 later) and the parent's boundaries: D1 (reads Automata's files, writes none, one hooks module, one toast per event per mod), D2 (no blocking here), D9 (`D:\s2` as lane 0, first row). PR state is not in the brief's A8 list but is in parent A8 (`prompt.md:54`); keeping it is right.
- Overclaimed: F-4 maps "A3 + A4 = parent A8". Parent A8 also requires overlap flags, toasts once per key, and screenshots with a staged overlap. Rev 2 covers A8 in part; `progress.md` must say "partial" until rev 3.
- F-1 is not blocking: parent D1 already decided Lanes is its own mod, and parent A9 and A10 make Lanes act (Start a lane, the merge press) while Board is read-only by its D2 and D6 (`docs/intent/ather-board/prompt.md:26`). Option B is closed by the parent.
- F-4's Found misreads the brief. The brief (line 60) asks for progress in `ather-lanes-mod/progress.md` "on your own branch"; what it forbids is editing `docs/intent/` on the two foundations branches (line 45). Option A is still right, for the honest reason: an S2 branch needs a pool lane (5-7 minutes, about 5 GB) for three table cells, and the foundations worker edits the same table on its branch, so the rows would conflict.

### C12. Refresh: feasible in the engine, but the cadence spends where nothing changes

- The engine gives what D3 needs: `$.ui.panes()` (`isShown`, `isPlaced`), `ui.render` raised only while a pane is placed, `ui.close`, `$.clock.every` (engine types 2.1.308). "Drawn" should mean `isShown`: a pane in a tab behind another is not shown.
- Status every 30 s is 20 PowerShell runs and about 60 git processes per 10 minutes for data that changes in minutes (lanes, branches, sidecars). The thing that changes fastest, slots, is files.
- Fix: slot and heartbeat files every 30 s (no process); Status and `for-each-ref` every 2 minutes and on `r`; gh every 5 minutes. Rows take "slot held" from the same slot files as the Slots section (holder name match), so the row and the section never disagree for two minutes. Two panes in two sessions double the cost; the gh answer kept in `$.store` with its time lets the second reuse it.

### C13. Ten cells do not fit at 72 columns, and A3 does not say what gives way

- Lane, branch, intent, tier, heartbeat, slot, behind, PR, waiting, overlaps: one line at 72 columns cannot hold them. Automata settled this for its rows (README 0.3.4: the title keeps 16 cells, right-hand columns give way in a fixed order, the same for every row).
- Fix: name the order in A3 (lane, slot held, behind, PR, waiting, last moved; then branch, intent, tier, which move to the opened row at 72) and test it at both widths.

### C14. Smaller points

- A session opened outside an S2 checkout, or in a non-S2 repository, needs a defined pane ("no lanes here"), and no process.
- A slot can be held by a name that is no worktree (`a0-race-b` in today's `slot-log.txt`); a fixture case.
- "Lane" means two things across the mods: Automata's `lanes/` folder holds session heartbeats (`state.mjs:638`), S2's lanes are worktrees. Lanes' text should say "session heartbeat" for Automata's files.
- Set a file budget (each file under 500 lines) so the thermo review's 1,000-line rule is never close; Board's `hooks/index.mjs` is 375.
- A6 says "skips the Windows-only tests elsewhere": with fixture-only unit tests there are none; the contract test (C9) is the one Windows-only test, so the line becomes true.

## Proposed rev 2 of prompt.md

Changes against rev 1 are marked with the critique id they answer.

```markdown
# Ather Lanes: the machine's lanes as a board

- Rev: 2
- Status: draft (proposed 2026-10-24 from review-rev1.md; waiting for the owner's review and go)
- Area: ather-lanes
- Owner: Tin Nguyen
- Skill: `plugin-authoring`
- Branch: `intent/ather-lanes`
- Started: 2026-10-24
- Parent: S2 `docs/intent/ather-lanes-mod/` rev 3 (on `sipherxyz/s2` branches `feat/agent-lanes-foundations` #34883 and `feat/agent-lanes-slots-status` #34885 until they merge). This intent is the mod side of the parent's A7 (in full), A8 (in part: rows, slots and cost; its overlap flags and toasts wait for the parent's A3 and A3') and A11. It decides nothing the parent decided and changes nothing on the S2 side. (C3, C11)

## Goal

The director runs six or more agent lanes on the Dev Drive (`D:\lanes\*`, plus `D:\s2` as lane 0) and today has no single place to see them: which worktrees exist, what each is for, when each last moved, who holds the Editor and build slots, how far each is behind `main`, which have a PR, and which wait on the director. Build **Ather Lanes**, a read-only mod in this repository whose pane (terminal and desktop) shows one row per worktree from what the S2 lane scripts and git already keep. It costs nothing while the pane is closed and runs at most one short process at a time while it is open. It loads next to Ather Automata and changes nothing Automata does. (C2, C4)

This is the first slice of the parent's part (1) "see": the rows and the slots. Overlap flags and toasts come in rev 3, once the parent's A3 report and strain data exist (F-6). The guard (parent A5), readiness and queue (A6), Start a lane (A9) and the merge press (A10) come in later revs. (C3)

## Non-Goals

- Overlap flags and toasts in this rev: no column, no toast code. Computing overlap at all: the mod never runs `git merge-tree` or diffs lanes. (C3)
- Writing anything of the lanes: sidecars, claims, slots, heartbeats, the pool. Only the S2 scripts write those. `lanes.ps1 -Action Status` moves a sidecar with no worktree to `_machine\lanes-stale\` by itself; the mod triggers that write and says so (A2, README). The mod writes only its own store. (C1)
- Writing anything of Ather Automata's (parent D1): its heartbeats, its state, the intent files. Automata is not changed by this intent.
- `git status`, `git fetch`, `git diff` or a tree walk in any lane or in `D:\s2`, on a timer or otherwise (parent Constraints).
- Any hook on `tool.call`, `tool.result`, `prompt.*` or `turn.*`, and any band above the prompt. (C6)
- A verdict on whether a lane is live: the board shows ages and their source; the threshold is the parent's (A5). (C4)
- Actions that hand the session a prompt (F-9). Merging, removing or starting lanes, and the edit guard (later revs; parent D4-D6, A5, A9, A10). (C10)
- A Paseo version, and the shared HTML page; both follow once the pane has been used.
- Any change to `.agents/skills/s2-agent-lanes/` or to S2's `docs/intent/` (other lanes are working there). What the mod needs from the scripts is listed in F-8.

## Decisions

Proposed in rev 2; each stands unless the owner changes it.

- D1 (proposed): a new mod, `ather-lanes/`: its own `plugin.json`, marketplace entry and one hooks module. It reuses Ather Automata's modules by copy: `rows.mjs` (row look, cell widths), `worklist.mjs` (`ageText`), `model.mjs` (`parseIntent`, `directorCalls`), `packs/unreal.mjs` (`parseEditorLock`, the pack's local folder), with what they import. One dev script makes every such copy: `ather-board/sync.mjs` moves to `dev/sync-shared.mjs <mod>`, each mod naming its entry modules, and `dev/test-all.mjs` checks Board and Lanes with it. No second sync script, no hand-made duplicate. (C5; F-1 is settled by the parent's D1)
- D2 (proposed): one pure reader per source, tested on fixtures; the hooks module only gathers inputs and draws. (C1, C4, C5, C7)
  1. `lanes.ps1 -Action Status -Json -Repo <the session's checkout> [-MachineDir <setting>]`, run as `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File`: the worktrees with `kind`, `sidecar`, branch, head, intent, tier, slot need, and `machineDir`. Taken as they are: the mod does not classify worktrees or join sidecars. About 0.42 s per run here, three git processes of its own.
  2. File reads under Status' `machineDir`, no process: `slots\*.txt` through `parseEditorLock` (holder, end, past its end) plus the first line's `kind <k>`; `heartbeats\<lane>.json` (`at`, `state`). Each worktree's Automata session heartbeats (`<worktree>\<pack local folder>\lanes\*.json`), used only when their `branch` is the worktree's branch.
  3. One `git -C <lane 0> for-each-ref --format="%(refname:short) %(ahead-behind:origin/main) %(committerdate:unix)" <each lane branch>` with `GIT_OPTIONAL_LOCKS=0`: ahead, behind and last commit for every lane branch in one process (0.06 s here for eight). Lane branches are named, never all of `refs/heads/`. A detached worktree shows no count. `origin/main`'s age is the last line of its reflog (`.git\logs\refs\remotes\origin\main`); the mod never fetches.
  4. One `gh pr list -R <owner/repo> --state all --search "head:<b1> head:<b2> ..." --json number,headRefName,state,isDraft,statusCheckRollup` for the lane branches (lane 0 and pool branches left out), run from a folder outside any checkout; owner/repo from lane 0's `.git\config`. At most every 5 minutes; the answer and its time are kept in the store, so a second session reuses it.
  5. Each registered lane's intent from `<lane>\docs\intent\<intent>\` through `parseIntent`; its waiting questions are `directorCalls`. A sidecar intent with no folder (an issue number) shows as the slug alone.
- D3 (proposed): refresh only while the pane is shown (`$.ui.panes()` `isShown`): the files of D2.2 every 30 s; D2.1, D2.3 and D2.5 every 2 minutes and on `r`; D2.4 every 5 minutes. Nothing at session start, nothing while the pane is closed or behind another tab. One process at a time; a run that comes due while one is running is skipped, never queued. Rows take the slot held from the same slot files as the Slots section. (C2, C12)
- D4 (proposed): read-only. Pressing a row opens it in place: sidecar fields, slot held and need, last commit, heartbeats with source and age, ahead and behind, the PR with its link, the titles of waiting questions. An unregistered worktree shows the `lanes.ps1 -Action Register` line to copy. No press hands the session a prompt in this rev. (C10, F-9)
- D5 (proposed): no toast in this rev. Rev 3 adds toasts keyed once per key per session, from this mod only, for a new binary overlap and a crossed strain line, when their sources exist. (C3)
- D6 (proposed): the scripts come from the `scriptsDir` setting, else the session's own checkout's `.agents\skills\s2-agent-lanes\scripts\`. A `machineDir` setting, empty by default, is passed to Status as `-MachineDir` (scratch proofs). Before spawning anything the mod checks that the machine folder exists (the setting, else `<lanes folder next to lane 0>\_machine`), so Status never creates it. A session outside a git checkout, a missing script or folder, or any read error: the pane says what it could not read and draws the rest, and starts no process for what is missing; the mod never fails a call. (C1, C8, C14, F-7)

## Acceptance

Ordered cheapest and highest value first. Each proof can fail. "Parent" ids refer to S2's `ather-lanes-mod` rev 3.

- A1: Lane records. One pure function turns the sources into one record per worktree: name, path, Status' `kind` and `sidecar` as given, branch, intent, tier, slot need and held, ahead, behind, last commit, `origin/main`'s age, heartbeats (source, age, state), PR (number, state, draft, checks), waiting questions (count and titles). Fixtures keep the shape of this PC's files of 2026-10-24 with every lane name, branch, issue number, path and host replaced. Cases: lane 0, a registered lane, an unregistered lane, pool ready and building, a harness worktree, a missing worktree, a sidecar intent with no folder, a half-written JSON, an Automata heartbeat on another branch, a `_machine` heartbeat, none at all, a branch with no PR, a detached worktree, a slot held by a name that is no worktree, a perf hold, no machine folder. Fails if any reader throws on bad input, or a record's kind differs from Status' `kind`. (C4, C5, C9, C14)
- A2: Slots shown, not re-implemented (parent A7). A Slots section lists every held slot with holder, kind, end time and "past its end", a perf capture as one hold of every slot, and "all slots free" when none is held; each row shows the slot it holds and its need. Proof: (i) a unit test: for one slot file and the pointer `editor-slot.ps1 Sync` writes from it, Lanes' holder and end equal Automata's `parseEditorLock` reading of the pointer; (ii) live on a scratch machine folder (`editor-slot.ps1 -MachineDir <scratch> -Isolated`, the mod's `machineDir` set to it): a `light` take appears within 30 s and its release clears it within 30 s; (iii) `grep` over `ather-lanes/` finds no write call under the machine folder and no call of `editor-slot.ps1`. The README names Status' stale-sidecar move as the one write the mod causes. Fails on a missed take or release, a holder or end mismatch, or a grep hit. (C1, C5, C6, C10)
- A3: The board (parent A8, its rows). `/lanes` opens a pane, terminal and desktop side panel, one row per worktree in Ather's row look: lane 0 first, pool lanes folded into one line ("0 ready, 2 building"), unregistered worktrees marked. Cells, in the order they give way last: lane, slot held, behind `main`, PR state, waiting questions, last moved; then branch, intent and tier. At 72 columns every row is one line with its first five cells whole and the rest on the opened row; at 110 every cell shows. Proof: `claude plugin test ather-lanes` mounts the pane on terminal and desktop from fixtures at 72 and 110 columns and presses a registered and an unregistered row; a live check on this PC lists exactly the names `lanes.ps1 -Action Status -Json` lists at the same moment, compared by a script; screenshots of both surfaces are the record. Fails on a missing or extra row, a wrapped row at 72, or a cut cell among the first five. (C6, C13)
- A4: Cost (parent A8, its process proof). A session with Ather Lanes alone loaded, started with `GIT_TRACE2_EVENT=<file>`, the pane open for 10 minutes during normal work with at least four worktrees, then closed for 5 minutes. From the trace (the parent's A2 method), for git processes started after the pane opened: none of the mod's runs `status`, `fetch`, `diff` or `merge-tree`; the mod's are exactly Status' three per run (`cmd_ancestry` through `powershell.exe`) and the one `for-each-ref`; no two of them overlap in time. From the mod's debug log of each spawn: PowerShell at most 6 runs plus one per `r` pressed, gh at most 3. Before the pane opens, and while it is closed: no process at all. Fails on any of them. (C2, C10, C12)
- A5: Coexistence (parent A11). `claude plugin validate ather-lanes` lists no hook on `tool.call`, `tool.result`, `prompt.*`, `turn.*` or `AbovePrompt`, and a test asserts the same of the hooks the module registers, so Lanes raises no toast on an `Edit` or a merge and adds nothing to any call's time. One live session with Ather Automata 0.6.6 and Ather Lanes: `/ather` and `/lanes` both open and both panes draw; one `Edit` and one `gh pr merge` attempt (refused or held, never a real merge) give Automata's toasts as with Automata alone and none of Lanes'; the transcript is the record. Fails on a listed hook, a Lanes toast, or a pane that does not draw. (C6)
- A6: Gates (parent A11). `node dev/test-all.mjs` runs Lanes' unit tests, the shared sync check for Board and Lanes, and, on Windows, a contract test: the real `lanes.ps1 -Action Status -Json -MachineDir <scratch>` on a scratch repository with two worktrees, read by Lanes' reader (elsewhere it is skipped with a message); it passes with and without `S2_ROOT`. Board's tests pass unchanged after the sync move. `claude plugin validate ather-lanes` and `claude plugin test ather-lanes` pass; marketplace entry and README; the thermo-nuclear review section in the PR with no critical finding open. (C5, C9, C14)

## Constraints

- No `git status`, `git fetch`, `git diff`, `git merge-tree` or tree walk, ever. The mod's git processes are Status' own and the one `for-each-ref` per refresh, with `GIT_OPTIONAL_LOCKS=0`. (C7)
- Nothing on a hook's path starts or waits for a process; a draw reads what the last refresh left. Every reader fails soft: a missing or half-written file is "unknown", never an error.
- The mod writes only its own store. No write call under the machine folder, any lane, `D:\s2` or Automata's folders. (C1)
- One canonical home for shared code: Ather's look and parsers in `ather-automata/hooks/` (copied by `dev/sync-shared.mjs`); lane policy (kinds, registration, slot rules, liveness) in the S2 scripts or the parent. A field the scripts lack is a request to the S2 side (F-8), not a second implementation. The `for-each-ref` and gh calls are the two exceptions and go when the parent's A6 `lane-ready.ps1` reports those fields (F-3). (C5)
- Each file under 500 lines; no file of Automata's or Board's grows by this intent except the sync move. (C14)
- The repository is public: no lane name, branch, issue number, path or host name of this PC in tests, fixtures or the README. (C9)
- This repository's `AGENTS.md`: thermo-nuclear review on every code change, gates green before and after; no push to `main` and no merge without the owner's go.

## Changelog

- Rev 1 (2026-10-24): drafted from the handoff brief (L-1); for review before a worker starts.
- Rev 2 (2026-10-24, proposed): from `review-rev1.md` (C1-C14). Overlap flags and toasts moved to rev 3 (C3); heartbeat column replaced by "last moved" from the branch tip and matching heartbeats (C4); sources taken verbatim from Status, slots through `parseEditorLock`, decisions through `directorCalls`, one shared sync script (C5); A4 measured with git's trace and a closed-pane window (C2); A5 proves no tool hook plus checks that can fail (C6); press actions cut (C10); fixtures anonymised and a contract test added (C9); refresh split by source (C12); column order at 72 (C13); script and machine-folder settings (C1, C8). F-5 to F-9 opened; F-1, F-3 and F-4 revised.
```

## Findings: new and changed

### F-1 (2026-10-24, rev 1; revised by this review) | blocking: no | status: proposed for closing (decided by the parent's D1)

**Found:** as in rev 1, plus: the parent's D1 already makes Ather Lanes its own mod, and its A9 and A10 have Lanes start lanes and run the T0 merge, while Ather Board is read-only by its D2 and D6 (`docs/intent/ather-board/prompt.md:26`). A Lanes view in Board would have to leave Board's read-only rule within two revs.
**Options:**
- A (recommended): a new mod `ather-lanes` (D1), sharing Ather's modules through one shared sync script (`dev/sync-shared.mjs`).
- B: a Lanes view inside Ather Board, accepting that Board later merges PRs and starts lanes.
- C: fold it into Ather Automata (the parent's F-7 option B, already rejected there).
**Proposed amendment:** D1 as in rev 2.

### F-3 (2026-10-24, rev 1; revised by this review) | blocking: no | status: open (director)

**Found:** `lanes.ps1 -Action Status -Json` has no ahead/behind, no last commit and no PR state. The parent already gives two of them a home: A6's `lane-ready.ps1` reports the behind-`main` count and the required checks (`prompt.md:52`). Measured: `for-each-ref` with `%(ahead-behind:origin/main) %(committerdate:unix)` takes 0.06 s for eight lane branches; one `gh pr list --search "head:a head:b"` takes 0.75 s and ORs the branches.
**Options:**
- A (recommended): the mod runs the one local `for-each-ref` per refresh and the one gh call per 5 minutes now, and drops both when `lane-ready.ps1` reports those fields.
- B: `for-each-ref` now; PR state waits for A6 (no network and no gh sign-in in the mod).
- C: both wait for A6; those columns are left out until then.
**Proposed amendment:** none for A (D2.3, D2.4, Constraints line four).

### F-4 (2026-10-24, rev 1; Found corrected by this review) | blocking: no | status: open (director)

**Found:** the brief asks for progress in S2's `docs/intent/ather-lanes-mod/progress.md`, rows A7, A8 and A11, "on your own branch"; it forbids editing `docs/intent/` on the two foundations branches. An own S2 branch needs a pool lane (5-7 minutes, about 5 GB) for three table cells, and the foundations worker edits the same table on its branch, so the rows would conflict when both merge.
**Options:**
- A (recommended): this intent's `progress.md` is the record (A2 = parent A7; A3 + A4 = parent A8 in part; A5 + A6 = parent A11); the parent's orchestrator copies the verdicts, with a link to this PR, and marks A8 partial until rev 3.
- B: take a pool lane and update the parent's rows on an own S2 branch once #34883 and #34885 merge.
**Proposed amendment:** none for A.

### F-5 (2026-10-24, this review) | blocking: no | status: open (director)

**Found:** on this PC no lane has a heartbeat that describes it: the lanes' workers are subagents of the `D:\s2` session, so Automata writes their heartbeat into `D:\s2`; `lane-overlap`'s is from a session that ended, on another branch; `_machine\heartbeats\` has one hand-written file. The skill asks long-running lanes to write `lanes.ps1 -Action Heartbeat` "now and then"; nobody does today.
**Options:**
- A (recommended): show "last moved": the branch tip's commit time from the `for-each-ref`, or a matching heartbeat when newer, with its source. No "live" verdict.
- B: A, and the director's worker brief asks each lane worker to run `lanes.ps1 -Action Heartbeat` at each step, so the heartbeat fills in.
- C: show nothing for liveness until Automata's own later release writes `_machine` heartbeats (parent D1).
**Proposed amendment:** none for A; for B a line in the S2 worker brief, outside this intent.

### F-6 (2026-10-24, this review) | blocking: no | status: open (director)

**Found:** the parent's A3 report has no format yet (`feat/lane-overlap` has no `lane-overlap.ps1`), and the strain data file of parent A3' does not exist. Ather Board's Colliding already compares open intents' branches with `git merge-tree`; the A3 report adds binary, OFPA, shared-package and uncommitted classes on top.
**Options:**
- A (recommended): no overlap column and no toasts in rev 2; rev 3 adds them once `lane-overlap.ps1` lands with a JSON output. Parent A8 stays partial.
- B: agree a JSON shape now with the lane-overlap worker through the parent's orchestrator, and build the column against a fixture of it.
**Proposed amendment:** none for A (rev 2 as written). For the parent's orchestrator: compare the A3 report with Board's Colliding before a third overlap check is built.

### F-7 (2026-10-24, this review) | blocking: no | status: open (director)

**Found:** `D:\s2` is 89 commits behind `origin/main` and lane work never updates it, so it gets the lane scripts late after the merge; until then the only copies are on branches other workers are changing.
**Options:**
- A (recommended): the `scriptsDir` setting, else the session's own checkout (D6); the director points the setting at a lane they trust until `D:\s2` is updated.
- B: the mod takes `lanes.ps1` and `_common.ps1` from `origin/main` (`git show`, object database) into its own data folder each time `origin/main` moves, so it only ever runs merged code. One git call per move; works only after #34885 merges.
- C: the S2 side copies the scripts into `_machine\bin\` when they change (an S2 change, later).
**Proposed amendment:** none for A.

### F-8 (2026-10-24, this review) | blocking: no | status: open (for the parent's orchestrator)

**Found:** what Ather Lanes needs from the S2 scripts, to drop its own workarounds later: (1) a read-only switch for `lanes.ps1 -Action Status` that moves no stale sidecar and creates no folder (`lanes.ps1:25, 61-70`, `_common.ps1:109-114`), for timed callers; (2) the heartbeat as an ISO time, not `'{0:n0} min'` (`lanes.ps1:89`); (3) slots in `-Json` with kind, purpose, end and old-style holders (today only `editor-slot.ps1 -Action Status` text, `:130-141`), and the slot counts, so free slots can be listed; (4) claims as a list, not a count. Also noted: `pool-lane.ps1` moves a worktree before it moves its sidecar (`:48-51`, `:67-69`), so a Status run in between files the pool sidecar as stale; harmless today.
**Proposed amendment:** none here; a finding in the parent once its `docs/intent/` is open again.

### F-9 (2026-10-24, this review) | blocking: no | status: open (director)

**Found:** rev 1's D4 gives each row actions that hand the session a prompt (open the lane's intent, ask where it stands, open the PR). A session in `D:\s2` already shows every worktree's intent in Ather Automata, with "Where it stands" and its decisions routed to the session that tracks them.
**Options:**
- A (recommended): rev 2's D4: details in place, the PR as a link, the Register line to copy for an unregistered worktree; no prompts.
- B: rev 1's D4: the three actions as prompts handed to the session.
**Proposed amendment:** none for A.
