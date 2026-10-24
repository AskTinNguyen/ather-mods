# Ather Lanes

The machine's S2 agent lanes in one pane: the decisions waiting for you, the lanes that need a look, and every lane on one line when you ask. It reads what the S2 lane scripts (`.agents/skills/s2-agent-lanes/scripts/`) and git already keep, and changes nothing. It costs nothing while the pane is closed. It loads next to [Ather Automata](../ather-automata/README.md) and changes nothing Automata does.

## In 30 seconds

- **`/lanes`** opens the pane. In a terminal it sits beside the chat; on the desktop it opens in the side panel.
- **For you**: every decision waiting for you (an open finding of a lane's intent that needs the director), one line each, under its lane's name. The lane whose decision has waited longest comes first.
- **A look**: one line per lane in trouble, with its reasons, worst first: its PR's checks are failing; it is 25 or more commits behind `main`; it holds a slot past that slot's end; it needs a slot that another lane holds; it is not registered.
- **The fold**: the last line. It gives how many lanes there are, the pool (ready and building), and who holds the Editor and for how long. Press it (enter in a terminal) to list every lane, one line each, then the held slots, who holds each, and who waits for it.
- **Press a lane** to open it in place: its decisions, its PR (with a link), how far it is behind or ahead of `main`, the slot it needs and holds, when it last moved and how that is known, then its branch, intent, tier and path. An unregistered worktree shows the `lanes.ps1 -Action Register` line to copy. A second press closes it.
- With nothing waiting and no trouble, the pane says **Nothing needs you.** above the fold.
- **r** (or ↻) reads again now.

A lane that is fine says nothing until you open the fold. Lime marks only For you, and amber only A look's reasons.

## Install

```bash
claude plugin install ather-lanes@ather --scope user
```

Then type `/lanes` in a session opened in an S2 checkout or one of its lanes.

## Where it reads, and when

Nothing runs before you open the pane, and nothing while it is closed or behind another tab. While it is shown:

| Every | What | How |
|---|---|---|
| 30 s | the slots (`_machine\slots\*.txt`, read as Ather reads the Editor lock), the lane heartbeats (`_machine\heartbeats\`), each worktree's Ather Automata session heartbeats (only those on the worktree's own branch), `origin/main`'s last move (its reflog) | file reads, no process |
| 2 min, and on r | `lanes.ps1 -Action Status -Json`: the worktrees, their kind and sidecar as the script gives them; one `git for-each-ref` for ahead, behind and last commit of the lane branches (with `GIT_OPTIONAL_LOCKS=0`); each registered lane's intent (`docs\intent\<slug>\`) | one PowerShell process, then one git process |
| 5 min | one `gh pr list` for the lane branches (lane 0's and the pool's left out), run from the machine folder; another session reuses the answer for 5 minutes | one gh process |

At most one process runs at a time; a read that comes due while one runs is skipped. The mod never runs `git status`, `git fetch`, `git diff` or `git merge-tree`, and never fetches: "main as of 19:04" is when `origin/main` last moved on this machine.

**The one write it causes.** `lanes.ps1 -Action Status` moves a sidecar whose worktree is gone to `_machine\lanes-stale\` by itself. Opening the pane runs Status, so it can trigger that move. Otherwise the mod writes nothing: no sidecar, slot, heartbeat, pool or Automata file, only its own store (the gh answer). It never calls `editor-slot.ps1`. It checks that the machine folder exists before it runs Status, so Status never creates one on a machine without lanes.

## Settings

Two settings, both empty by default; `/config` lists them under Ather Lanes:

- **scriptsDir**: the folder holding `lanes.ps1`. Empty: the session's own checkout's `.agents\skills\s2-agent-lanes\scripts\`. Point it at a checkout whose scripts you trust when the session's own checkout has none yet.
- **machineDir**: passed to Status as `-MachineDir`. Empty: `<the lanes folder next to the main checkout>\_machine`. Set it only for a scratch proof.

Outside a git checkout, without the scripts, or without a machine folder, the pane says what it could not find, draws the rest, and starts no process.

## Changes

- **0.1.0** First release: For you, A look, the fold and every lane opened in place, from `lanes.ps1 -Action Status -Json`, the slot and heartbeat files, one `for-each-ref` and one gh call.

## Maintainers

The pane's look, the intent parser and the Editor-lock reader are Ather Automata's own modules, copied into `hooks/ather/` by `node dev/sync-shared.mjs ather-lanes` (the entry modules are named in `shared.json`); never edit those copies. The mod's own files: `hooks/sources.mjs` (one pure reader per source), `hooks/records.mjs` (one record per worktree), `hooks/board.mjs` (what the pane shows), `hooks/pane.mjs` (its lines and drawing) and `hooks/index.mjs` (the engine half: the command, the timer, the processes). `node dev/test-all.mjs` checks the copies and runs `tests/*.test.mjs` on the made-up machine in `tests/fixtures/`. On Windows, with the lane scripts at hand (`LANES_SCRIPTS`, or `S2_ROOT`'s), it also runs the real `lanes.ps1 -Action Status -Json` on a scratch repository and reads its output. Then run `claude plugin validate ather-lanes` and `claude plugin test ather-lanes`, bump `version` in `.claude-plugin/plugin.json` and the repository's `.claude-plugin/marketplace.json`, and add a line under Changes.
