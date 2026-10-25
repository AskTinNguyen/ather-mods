# Ather Lanes

The machine's S2 agent lanes in one pane: the decisions waiting for you, the lanes that need a look, and every lane on one line when you ask. It reads what the S2 lane scripts (`.agents/skills/s2-agent-lanes/scripts/`) and git already keep, and changes nothing. While the pane is closed it starts no process: the status line is kept fresh by reading files. It loads next to [Ather Automata](../ather-automata/README.md) and changes nothing Automata does.

## In 30 seconds

- **`/lanes`** opens the pane. In a terminal it sits beside the chat; on the desktop it opens in the side panel.
- **For you**: every decision waiting for you (an open finding of a lane's intent that needs the director), one line each, under its lane's name. The lane whose decision has waited longest comes first.
- **A look**: one line per lane in trouble, with its reasons, worst first: its PR's checks are failing; it is 25 or more commits behind `main`; it holds a slot past that slot's end; it needs a slot that another lane holds; it is not registered.
- **The fold**: the last line. It gives how many lanes there are, the pool (ready and building), and who holds the Editor and for how long. Press it (enter in a terminal) to list every lane, one line each, then the held slots, who holds each, and who waits for it.
- **Press a lane** to open it in place: its decisions, its PR (with a link), how far it is behind or ahead of `main`, the slot it needs and holds, when it last moved and how that is known, then its branch, intent, tier and path. An unregistered worktree shows the `lanes.ps1 -Action Register` line to copy. A second press closes it.
- With nothing waiting and no trouble, the pane says **Nothing needs you.** above the fold.
- **r** (or ↻) reads again now.
- **The status line** under the prompt names this session's lane and what waits, for example `lane combat-hitstop · ◆ 3 for you · 1 to look at` (`lane 0` in the main checkout, `not in a lane` elsewhere on the machine; a count shows only when it is not zero). It is text only: the engine's status line takes no press or hotkey, so type `/lanes` to open the pane.
- **Ask Claude**: "which lane am I in?" calls the `lanes_summary` tool (this session's lane with its branch, intent, tier, slot and PR, then every For you and A look item); "show the lanes" calls `lanes_open`, which opens the pane as `/lanes` does, and with a lane's name opens that lane in place.
- **This session's lane** is marked `this session` (quiet) wherever it shows: beside its name in For you and A look, in its opened details, and in the opened fold, where it comes right after lane 0.

A lane that is fine says nothing until you open the fold. Lime marks only For you, and amber only A look's reasons (in the pane; the status line is plain text).

## Which lane am I in?

Look at the status line: `lane <name>` is the worktree this session's checkout is. Or ask Claude "which lane am I in?". The match is by folder (case and slashes aside): a session started in a folder inside a lane is in that lane; a harness worktree inside the main checkout is its own worktree, not lane 0. Before the pane has first been opened on the machine, a worktree outside the lanes folder (a harness one) reads `not in a lane`, as only `lanes.ps1 -Action Status` lists those.

## Install

```bash
claude plugin install ather-lanes@ather --scope user
```

Then type `/lanes` in a session opened in an S2 checkout or one of its lanes.

## Where it reads, and when

On a machine with lanes (a checkout whose machine folder exists), from the session's start and while the pane is closed or behind another tab, once a minute at most, and with no process: the sidecars (`_machine\lanes\*.json`), one listing of the lanes folder (a folder in it with a `.git` is a worktree; no tree walk), the slots, the heartbeats and each registered lane's intent. That is enough for For you and for A look's slot and unregistered reasons. The reasons that need git or gh (checks failing, behind `main`) come from the last full read the pane made, on this machine and kept in the mod's store; they are never read while the pane is closed. The status line and `lanes_summary` say what those reads left. While the pane is shown:

| Every | What | How |
|---|---|---|
| 30 s | the slots (`_machine\slots\*.txt`, read as Ather reads the Editor lock), the lane heartbeats (`_machine\heartbeats\`), each worktree's Ather Automata session heartbeats (only those on the worktree's own branch), `origin/main`'s last move (its reflog) | file reads, no process |
| 2 min, and on r | `lanes.ps1 -Action Status -Json`: the worktrees, their kind and sidecar as the script gives them; one `git for-each-ref` for ahead, behind and last commit of the lane branches (with `GIT_OPTIONAL_LOCKS=0`); each registered lane's intent (`docs\intent\<slug>\`) | one PowerShell process, then one git process |
| 5 min | one `gh pr list` for the lane branches (lane 0's and the pool's left out), run from the machine folder; another session reuses the answer for 5 minutes | one gh process |

At most one process runs at a time; a read that comes due while one runs is skipped. The mod never runs `git status`, `git fetch`, `git diff` or `git merge-tree`, and never fetches: "main as of 19:04" is when `origin/main` last moved on this machine.

**The one write it causes.** `lanes.ps1 -Action Status` moves a sidecar whose worktree is gone to `_machine\lanes-stale\` by itself. Opening the pane runs Status, so it can trigger that move. Otherwise the mod writes nothing: no sidecar, slot, heartbeat, pool or Automata file, only its own store (the gh answer and the last full read). It never calls `editor-slot.ps1`. It checks that the machine folder exists before it runs Status, so Status never creates one on a machine without lanes.

## Settings

Two settings, both empty by default; `/config` lists them under Ather Lanes:

- **scriptsDir**: the folder holding `lanes.ps1`. Empty: the session's own checkout's `.agents\skills\s2-agent-lanes\scripts\`. Point it at a checkout whose scripts you trust when the session's own checkout has none yet.
- **machineDir**: passed to Status as `-MachineDir`. Empty: `<the lanes folder next to the main checkout>\_machine`. Set it only for a scratch proof.

Outside a git checkout, without the scripts, or without a machine folder, the pane says what it could not find, draws the rest, and starts no process.

## Changes

- **0.2.0** The status line (this session's lane, For you and A look's counts), kept fresh from files while the pane is closed, never a process; the `lanes_summary` and `lanes_open` tools; this session's lane marked in the pane and listed after lane 0 in the opened fold.
- **0.1.0** First release: For you, A look, the fold and every lane opened in place, from `lanes.ps1 -Action Status -Json`, the slot and heartbeat files, one `for-each-ref` and one gh call.

## Maintainers

The pane's look, the intent parser and the Editor-lock reader are Ather Automata's own modules, copied into `hooks/ather/` by `node dev/sync-shared.mjs ather-lanes` (the entry modules are named in `shared.json`); never edit those copies. The mod's own files: `hooks/sources.mjs` (one pure reader per source), `hooks/records.mjs` (one record per worktree), `hooks/board.mjs` (what the pane shows), `hooks/pane.mjs` (its lines and drawing) and `hooks/index.mjs` (the engine half: the command, the tools, the status line, the timer, the processes). `node dev/test-all.mjs` checks the copies and runs `tests/*.test.mjs` on the made-up machine in `tests/fixtures/`. On Windows, with the lane scripts at hand (`LANES_SCRIPTS`, or `S2_ROOT`'s), it also runs the real `lanes.ps1 -Action Status -Json` on a scratch repository and reads its output. Then run `claude plugin validate ather-lanes` and `claude plugin test ather-lanes`, bump `version` in `.claude-plugin/plugin.json` and the repository's `.claude-plugin/marketplace.json`, and add a line under Changes.
