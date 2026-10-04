# Ather Automata

Working the S2 way with Claude Code: what needs you, what to do next, and a safe pair of hands while you are away.

## In 30 seconds

- **Type `/ather`** whenever you wonder what to do. What needs you comes first, then the next step for your work, ready to send.
- **New here?** `/ather tour` walks you through it in six short steps and ends with your first piece of work started. In a hurry, skip it; Ather just asks your role.
- **Leaving?** `/away tonight` (or `8h`, `until 9am`, `until done`). The session keeps working; merges wait for you. When you are back, `/ather` → **I'm back: see what happened**.

## What you see

| Where | What |
|---|---|
| Terminal | `/ather` opens one pane: where your work is (Plan ✓ ─ Build ● ─ Prove ○ ─ Ship ○) and the proof so far, what needs you, then Next, then other work you could pick up. Enter hands a row to the session. |
| Desktop app | `/ather` opens the same pane in the side panel; click a row to hand it to the session. |
| Above the prompt | One line: what needs you, a running window, or just the name; then ☾ away, ⤢ open the pane, ✕ hide it until something is new. |
| Pop-ups | A known trap with its fix, a build that really failed, a merge that dropped your edits, a worker gone quiet, a thin worker brief. |

## What to work on

Each session works on one intent. A new session offers to continue the one you last worked on. With nothing tracked, Ather offers one list: your open intents, then the GitHub issues assigned to you that have no intent yet (high priority first), then teammates' intents you could follow (read-only: their decisions stay theirs).

Clicking an issue opens its card: **Start an intent**, **Open on GitHub** or **Copy link**. Starting one asks the session to check for overlapping work first (the issue preflight), then draft an intent linked to it (`- Issue: #28887`) and show you the plan before anything is built. Ather reads your issues with `gh` and never writes to GitHub. `/ather issues` lists them; `/ather issue 28887` or `#28887` starts one.

## Going away

- **Allowed** without asking: pushing branches and opening draft PRs and PRs to main.
- **Held** until you review the window: merges into main (also through `gh api`) and pushes to main, however they are spelled. Each command is judged on the branch of the folder it runs in, so pushing your feature worktree is never held.
- **Questions** the session would ask go to a decision ledger with its choice and reasons, while you are away and after the window ends, until you type anything.
- **Coming back:** "I'm back" ends the window and walks you through every decision (keep, undo, talk it through) and every held action (run it now, or drop it). A new session the next morning picks up last night's window.

## Proof

Ather reads evidence from tool output, never from what the session says: an S2Editor build's own Result line, a test run whose tests passed (no tests, a failure or a non-zero exit is a fail), a started PIE or test simulation run, and a read-back from the server that was written to. A tech artist's own Editor check is `/ather checked`. Proof is kept with the intent for a day, so yesterday's build still counts this morning. Until you say your role, any role's proof counts.

## Commands

| Command | Does |
|---|---|
| `/ather` | What needs you and what is next |
| `/ather tour`, `/ather skip` | The tour, or skip it and just say your role |
| `/ather pick [words]`, `/ather intent <name>` | Choose what this session works on |
| `/ather issues`, `/ather issue <number>` | Your GitHub issues; start one |
| `/ather role <in your words>` | Designer, tech artist or engineer |
| `/ather checked` | Record your own Editor check |
| `/away [8h \| 30m \| until 9am \| tonight \| until done] [goal]` | Hand over while you are away |
| `/away stop` (or "I'm back") | End the window |

Anything else you type after `/ather` or under Other goes to the session as a question.

## Install

Claude Code 2.1.287 or later, in an S2 checkout:

```bash
claude plugin marketplace add AskTinNguyen/ather-mods
claude plugin install ather-automata@ather --scope user
```

Setting: `briefGate` (`warn`, `enforce` or `off`) for worker briefs that lack paths, acceptance checks or the shared-tree rule.

## Limits

- Where a surface has no pane (the mobile app), `/ather` asks one question instead; option descriptions may not show there, so labels stand alone.
- Your role, the tour, trap counts and the issue list are kept on your machine, not shared across the team.
- It never merges, commits or pushes on its own. It is a safety net, not a permission system, and it does not stop tree-rewriting git in the shared checkout (`deny_root_paths.py` does that, outside this plugin).

## For maintainers

One hooks module (`hooks/ather.mjs`) made of two halves. `watch.mjs` protects work and has no interface beyond pop-ups; `console.mjs` draws. They share state only through `state.mjs`, the one owner of every stored value, which applies changes one at a time. The pure logic is split by concern: `model.mjs` (intents, stages, next step), `guards.mjs` (shell and MCP checks, traps), `away.mjs` (window rules), `issues.mjs` (GitHub issues), `home.mjs` (what the console shows). Background hooks never get in the way of the calls they watch; the mod shows state and routes, and the session does the talking.

Tests: `tests/ather.test.mjs` ships with the plugin. An end-to-end run in the marketplace repo (`dev/test-all.mjs`) drives the real code against a stand-in engine that answers dialogs the way the app does and lays out every pane at 72 and 110 columns.

## Changes

- **0.0.1** First shared release. The pane (terminal and desktop side panel) with what needs you, Next, your intents and assigned GitHub issues, New intent and a curated Skills list; issue cards (start an intent, open on GitHub, copy link); the band with away, open and close; away windows with held merges and a decision ledger; evidence read from tool output; the newcomer tour.
