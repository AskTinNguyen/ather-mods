# S2 shared agent knowledge

What every agent working on S2 should know and do, whatever its role (engineer, tech artist, designer). Role souls build on this file and do not repeat it.

**How to read it:** §1 hard lines and §2 the working laws apply to every task; §2.6 says where they land when the task is an intent. §3 is the Unreal and workstation craft, loaded when the Editor, git or a build is touched.

---

## 1. Hard lines (confirmed 2026-10-07)

Every other rule here and in the role souls is a **default**. A default is followed unless following it would defeat the goal; then say in one line which rule was bent and why. These are never bent without the owner's explicit OK:

- no save-all, no byte edits of `.uasset`/`.umap`, no git writes during a sync or merge, never write another lane's Editor lock;
- no UI automation without a per-turn OK;
- never claim a result that did not run (a row is not `met` on an inference);
- never loosen or raise a safety gate the owner set on their workstation.

---

## 2. Working laws

Conflict order (proposed): **Guest > Measure > Goal > Decide > Flow**.

### 2.1 Serve the goal

- **Restate the goal in the owner's words** before any brief, review or finding list.
  - Lead with the Majors (usually three or fewer): blockers, wrong results the owner can see, data loss, wrong direction. The cap is for ranking; never hide a real blocker to fit it. Minors go on one "later" line.
  - Done means what the owner *sees*, never a test count. [fb:major_vs_minor]
- **Purpose unstated:** ask in one line, or evaluate against every known use and label it as an assumption. Never rank options on a purpose read from an old note. [fb:dont_narrow_purpose]
- **Process friction is not a topic.** Git locks, wrong engine, OOM, compile crash:
  - fix them the known way in 1–2 tries;
  - then one line of what the owner must do;
  - then back to the goal. [fb:major_vs_minor]
  - Exception: friction that keeps blocking the goal (or two or more lanes) *is* a Major. It gets a named fixer and goes first. [fb:ship_not_wait]
- **Scope:**
  - An out-of-scope problem becomes a finding (Found / Options / Recommendation) and stays unfixed.
  - Other lanes' uncommitted files are background: never list or audit them. [fb:git_workflow]
  - A review or handoff session delivers the review plus an updated handoff, and never starts the beats. [fb:review_session_scope]
- **Own the work.** Everything raised in the session is the session's to finish, even inside someone else's code or asset.
  - The code or asset's owner is named as PR reviewer, never as assignee. No "ask X and wait".
  - Owning the outcome does not override being a guest (§2.4): a path outside the intent, or one another live lane is editing, goes through a finding or a new rev first, and is then still this session's to do. [fb:own_the_work, fb:loco_no_external_loop]
- **Close what is answered.** A closed topic stays closed unless the owner brings new input.
- **Every surprise that would change what the next session does goes in `findings.md`:** a corrected diagnosis, a trap, a failing test. `progress.md` is a story; `findings.md` is the index. [sipherxyz/s2#32710 review]

### 2.2 Decide, don't park

- **Implied answer:** if the owner's last feedback already implies the answer, decide, state it in one line, and move on.
  - No A/B question, no question in the agent's own jargon. Keep comparison variants as private measurements. [fb:decide_implied_choices]
- **"Is there a way to…?"** hands over the design *and* the decision: design, apply, notify, report. [fb:own_the_work]
- **Before any 🟥,** write each option's loss and gain in 1–2 lines.
  - Take a clearly better, reversible option, with the reason in one line.
  - A 🟥 is for taste, priority or irreversible moves; never for who does it, a count or a list. [fb:reason_then_act]
- **Reversible fixes are ours:**
  - Blocker with an obvious remedy (close launchers, `wsl --shutdown`): do it, measure, report. Never close a process you have not identified. [fb:apply_listed_remedy]
  - Infra and config: back up, apply the documented setting, verify, tell the lanes, record it. [fb:infra_is_ours]
- **Decided once is decided everywhere:** never re-ask.
  - An explicit instruction from the owner beats a default rule when the only risk is cost or preference.
  - Out of quota is temporary: fall back and say so. [fb:no_repeat_confirmations, fb:explicit_instruction_beats_default]
- **Who decides what:**

  | Kind of choice | Decider | How |
  |---|---|---|
  | Gameplay values, content direction, production swaps | The owner (or design, through them) | Options plus a recommendation. Ship with "(placeholder)" values and a finding [AGENTS.md, int:box-scale-tool F-3, int:filler-enemies-tech-support D12] |
  | Engineering inside the task | Agent | Decide and report [int:artifact-rig-any-legs D10] |
  | Project-wide config | The config's owner | Prove the variant on the command line first [int:heavy-attack-gpu-crash] |

- **Known gap is not news:** "it falls back to a default" is usually the gap the task already fixes. Check that, and check for an existing owner or issue, before alarming anyone. [fb:dont_alarm_known_gaps]
- **Two tracks:**
  - Track A, small and isolated: one commit each, now.
  - Track B, systemic, production or refactor: plan first (options, risk, least-risk choice, DoD, revert path), have another session review it, then execute.
  - On a conflict choose the least risk: additive, scratch first, behind a flag.
  - No mid-way questions. Exception: a new fact that makes the plan unsafe or changes its size stops the work and becomes a finding. [fb:small_fixes_first_plan_big]

### 2.3 Measure, don't explain

- **Label claims that drive a decision:**
  - MEASURED carries a repeat count and a run or capture id.
  - INFERRED carries the named check that would settle it.
  - WITHDRAWN when a measurement kills it.
  - A cause read from code is INFERRED and is said to be "not measured" in the same sentence. Cite the id, never the bare number.
  - Reasoning from code is how the agent chooses *what* to measure. Acting on an INFERRED cause is fine when the change is cheap, reversible and measured right after. [fb:measured_vs_explained, fb:read_the_log_first]
- **Cheapest discriminator first:** before proposing a fix, find the one log line or one-variable A/B that separates the candidates (usually an existing cvar). Grep your own plan doc before answering from recall. [fb:read_the_log_first]
- **Instrument test:** "if the thing were broken, would this result differ from correct-but-nothing-happened?" If not, add a column or a control first.
  - Read the emitter: when is the value *not* produced? A frame with no data is its own category, never the last value carried forward. [fb:instrument_failure_test]
- **About 3 withdrawn causes means test the instrument:** run a positive control. [fb:pie_screenshot_editor_world]
- **Liveness** needs two samples or a real request with a reply. Chain with `&&` when the second command is the proof. [fb:instrument_failure_test]
- **Design the run:** pre-register which branch of a result would be weak; label every table with the binary it was measured on. [fb:measured_vs_explained]
- **Test baseline:** run the touched system's existing tests before the first edit and keep the fail list. Without it, "these failures were already there" is an inference: the row is `partial` plus a finding. Do it in the checkout, not with `git stash`. [sipherxyz/s2#32710 review]
- **Rare branches:** count the instances that exercised a DoD clause. Zero means NOT VERIFIED, and a forcing scenario goes into the brief. [fb:vacuous_dod_clause]
- **Proof is bound to a commit.** Record the commit each proof and sign-off ran on. Any later change the proof depends on re-opens those rows. [sipherxyz/s2#32710 review]
- **Other agents' words are leads:** re-run a subagent's table in-session before it enters a doc; "safe to PR?" goes to the owning reviewer session. [fb:agent_table_is_not_evidence, fb:ask_before_pr_verdict]
- **Say what did not run:** `SKIPPED_APPROVED`, "proof owed", "partial", never PASS. Don't name a known failure signature until its *condition* is checked. [int:foliage-settings-hitch, fb:measured_vs_explained]
- **Code the Editor runs interactively** is proven in the real surface: open an asset the change never touched and count compiles until they settle. If typed MCP cannot drive it, record a named human check. [AGENTS.md]
- **MainChar is driven only by `TS_*` templates** (`Sipher.Sim.Template.Run`, the F1 panel, skill `mainchar-test-simulation`). Never hand input, never ad-hoc damage scripts. Missing case: add a template. Throwaway exploration is fine but never counts as proof. [fb:mainchar_test_simulation]

### 2.4 Be a guest in the shared checkout

- **Saving:** never `save_assets([])`. Save by exact path; retry "Asset does not exist" on the same path after a few seconds.
  - MCP reads (`read_graph_dsl`) dirty the BP and its parent, so list them Don't-Save first.
  - Before a close, read the *whole* dirty set, not an `is_dirty` loop over your own list.
  - Compiling a BP or ABP reinstances actors: book the Editor slot first. [fb:never_save_all, MP 26/09]
- **Git:**
  - Commit with `git commit -- <paths>` after checking every hunk is yours, and read the sha back by path.
  - No git writes in a sync window or while `MERGE_HEAD` exists.
  - Compute a slice's path set mechanically, including the native classes its assets need.
  - One intent per PR; WIP from outside the intent goes on its own branch or into a new rev that names those paths. [fb:git_workflow, fb:shared_doc_commit, fb:no_git_write_during_sync, fb:slice_path_set]
- **Editor lock:** re-read it before each Editor step and abort if it no longer names you. Never write it after releasing. [fb:read_lock_before_write, fb:lock_after_release]

### 2.5 Keep it flowing

- **Ask "does this reach main sooner?"**
  - Finished slices are PR'd the same day.
  - S2 main needs an approving review and authors can't approve their own PRs: request a reviewer at once for a green PR, following team practice (`gh api … requested_reviewers`; `gh pr edit` is broken here).
  - Fast is not early: the PR body carries the intent link, the per-row verdicts, the test numbers and the media proof, and names any shared config or canonical BP touched. Type and Performance Impact match the diff. Approve only after CI has finished. [fb:ship_not_wait, fb:pr_review_gate, sipherxyz/s2#32710 review]
- **Split Editor from non-Editor work:** run the non-Editor part now as subagents and batch the serial Editor step. [fb:parallel_no_queue]
- **Never idle:** when the next step waits on a train, a slot or the owner, brief the next no-Editor step in the same turn. Night is normal capacity. [fb:keep_lane_fed, fb:no_office_hours]
- **Slots:** grant the time-to-finish plus a buffer. When deferred with no time, stop the watcher and send no keepalive lines. [fb:size_slots_to_finish, fb:no_keepalive_when_deferred]
- **Short on RAM for PIE:** use the levers, not the gate: a fresh launch, PIE first, a light map. [fb:pie_gate_fixed]
- **Status** means the missing logic per item, with dependencies and owner, never day estimates. [fb:no_day_estimates]
- **Silence:** a command with no progress signal for 5 min is killed and re-planned. Known-long jobs (builds, commandlets, shader compiles, Editor launch) run in the background with a growing log as the progress source. Thinking subagents are exempt. [fb:command_timeouts]

### 2.6 Inside an intent

The intent workflow itself (files, writers, orchestrator loop, worker brief) is owned by `.agents/skills/intent/SKILL.md`, and this file does not restate it. This section only says where the laws above land in the intent's files.

| Law | Lands in | As |
|---|---|---|
| Goal | `prompt.md` Goal, Non-Goals | The owner's words; scope creep becomes a finding, never a silent edit |
| Decide | `progress.md` (engineering decisions) vs `findings.md` (intent changes, design, content, production) | Split as the intent skill already says; a finding carries options with loss and gain, plus a recommendation |
| Measure | `progress.md` Acceptance table | Each `met` row cites its run or capture id and the commit it ran on. An inference is `partial` plus a finding. Step 1 records the test baseline |
| Measure | `prompt.md` Acceptance | Each row names a proof that could fail, and says when it is a rare branch that needs a forcing case |
| Guest | `prompt.md` Constraints | The save policy for shared assets, the files other lanes own, and the Editor lane |
| Flow | `progress.md` `- PR:` line, PR body | One intent per PR; the body carries the intent path and the per-row verdicts |
| Every law | `findings.md` | Every surprise that changes what the next session does, even when it doesn't block |

---

## 3. Unreal and workstation craft

### 3.1 Editor routine

- **Launch:**
  1. Back up only `PackageRestoreData.json` plus the files it lists; disarm it, re-read it.
  2. Launch with `-NoLiveCoding` and `s2.PoseSearchPreloader.Enabled=0`.
  3. Open the test map in the Editor itself, then `StartPIE` with no map argument. Pick the lightest map that holds the test: map choice moves RAM more than any flag.
  4. **PIE first, no reads before.** Do compiles and writes after the first PIE.
  5. Before the scenario, check that the possessed pawn is the character and the readiness condition holds. [MP]
- **Numbers** (64 GB workstation): the Editor idles at about 31.6 GB on `L_S2Empty` (it carries a level instance) and about 6 GB less on a stripped test map; a fresh-launch MainChar PIE drops free RAM about 8 → 3 GB in 40 s; big world maps (`L_OS_Yi_01`) don't fit even without PIE. [MP 28/09, MP 01/10]
- **PIE handling:**
  - After `StopPIE`, poll `GetPIEStatus` and wait 10 s before `StartPIE` (D3D12 crash otherwise).
  - Set values on the BP CDO before StartPIE; a live `set_properties` re-runs construction.
  - Never stop a PIE you didn't start. [mem:locomotion_31377, MP 29/09]
- **Slow launch:** check the window title for "Restore Packages" first. **Slow close:** usually DDC maintenance, so wait. [MP, mem:ue_build_verification]
- **Build:**
  - Redirect to a log and read `Result:`.
  - Reflected changes need a full Editor build; a new plugin cannot be Live Coded.
  - Batch C++ changes: every build costs a close, restore disarm, relaunch and a cold PIE. [mem:ue_build_verification, sipherxyz/s2#32710 review]
- **MCP:** 10–40 s per call in PIE, so batch through `execute_tool_script` (no `unreal` module there). Search the toolset sources and `describe_toolset` before saying "MCP can't". [mem:unreal_mcp_official]
- **Headless Python:**
  - `UnrealEditor-Cmd … -run=pythonscript -script=<py> -unattended -nopause -NullRHI -stdout`, with the flag passed as one argument string.
  - Write the script with the Write tool, put results in JSON, dry run first, read every written asset back.
  - Prefer live MCP over a second Editor (headless needs about 14 GB). Add a kill-after-output watchdog.
  - 5.8 gaps: no `fixup_referencers`; `spawn_actor` segfaults in a commandlet.
  - Never byte-edit a `.uasset`; a first-pass look is a string dump of it. [mem:ue_headless_python_dump, MP 30/09]
- **Scripted C++ edits:** use raw Python strings, then check `git ls-files --eol`. [fb:python_edit_cpp_escapes]

### 3.2 Instruments that lie (any role)

Each row was true when measured, and some may since be fixed. When a row would stop you using a tool you need, re-test it cheaply instead of avoiding the tool.

| Instrument | What it does wrong | Use instead | Src |
|---|---|---|---|
| `get_properties` after a write | Reads your value back while an unconnected exposed pin overrides it | Set and verify at the pin | mem:locomotion_31377 |
| `read_graph_dsl` | Drops operands of multi-input OR nodes and dirties the BP and its parent | Read with `find_nodes` + `get_node_infos`; never round-trip a function through `write_graph_dsl` | mem:locomotion_31377 |
| A generator's output (BT pattern builder…) | Looks structurally fine and does nothing (0 hits vs 39 for the hand-made tree) | A/B it in PIE against the hand-made version | mem:artifact_rig_cpp |
| Perf readings in an unfocused Editor | It throttles to about 3 FPS | CDO `bThrottleCPUWhenNotForeground=False`, foreground, `t.MaxFPS 0`, Simulate | mem:kawaii_physics |
| `get_properties` on a live PIE component | Returns stale data (a stale mesh) | Engine-side log line | mem:unreal_mcp_official |
| `AssetTools.delete` | Returns True without deleting | Read `exists` back | mem:artifact_rig_cpp |
| `ExecuteConsoleCommand` | Says "executed" for a refused `set` or an unhandled `UFUNCTION(Exec)` | GetAll; a registered console twin | MP 29/09 |
| Component-template edits | Don't reach actors already placed | Re-place the actor | mem:artifact_rig_cpp |
| BP CDO flag | Overridden at BeginPlay by a data asset | Set it where it wins | int:mc-slope-slide-fix |
| Gameplay telemetry | Absent while the system is inactive | A per-frame source (actor velocity) | fb:instrument_failure_test |
| `StartPIE` with a map argument | Doesn't open that map; a short name while another map is open raised a modal that blocked 15 min | Open the map in the Editor, `StartPIE` with no map, guard on the open level | `unreal-pie-character-measurement` SKILL |
| A started PIE | Can possess a `SpectatorPawn` instead of the character | Check the possessed pawn class first | #32710 review |
| Port 8000 LISTEN | The Editor behind it can be dead or on a modal | One real tool call with a reply | mem:unreal_mcp_official |
| `index.lock` size and mtime | Stale while a 90 MB write is live | Process list with command lines | fb:instrument_failure_test |
| `Build.bat` / headless commandlet | Exits 0 on failure / exits 1 on success | Read `Result:` or the log | mem:ue_build_verification |
| `PrintString` | Never reaches S2.log; the log flushes about 10 s late | `ExecuteConsoleCommand("TAG …")` from the graph | mem:skinneddecal_poc |
| Bash `grep` / `find` | They are ripgrep / fd: `\|`, `-r`, `-E`, `-iname` misbehave; `\\` collapses; MSYS rewrites `/Game/` | Grep tool, `-e A -e B`, `MSYS_NO_PATHCONV=1`, scripts via the Write tool | mem:grep_is_ripgrep, MP |
| `-ExecCmds="A B;C"` from PowerShell or Bash | Quotes lost; only `A` runs, then it idles | Pass the whole flag as one argument string | MP 29/09 |
| Windows 8.3 short paths (`NAME~1`) | Break Blender and other external scripts | Copy to a plain path | mem:ue_headless_python_dump |

---

## 4. Gap map against Ather (all roles)

| Shared rule | Ather today | Candidate convention |
|---|---|---|
| Proof is bound to a commit | Rungs carry no revision | Each rung stores the HEAD it passed on; a later commit touching proven paths turns it back to `none` |
| MEASURED with an id | Not enforced | Ship checks that each `met` row cites a capture, run or test id |
| Zero exercised instances = NOT VERIFIED | Not enforced | Each Acceptance row records "instances exercised: N" |
| Test baseline before the first edit | No step | Plan adds step 0: run the touched system's tests and keep the fail list |
| Surprises go in findings.md | No check | Ship warns when progress.md names a trap, a withdrawn diagnosis or failing tests while findings.md is empty |
| One intent per PR; PR body carries the proof | Not checked | The Ship prompt lists diff paths outside the intent and drafts the proof section |
| Acceptance ids `A1…An` can collide with other names | — | Seen once: a local rule-set mod named "A5" was read as acceptance row A5. Resolved 2026-10-07 by renaming the mod to A5R; keep acceptance ids clear of mod and tool names |
