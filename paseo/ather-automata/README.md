# Ather Automata for Paseo

The [ather-automata](../../ather-automata/README.md) mod as a [Paseo](https://paseo.sh) plugin: what needs you, what to do next, and a safe pair of hands while you are away, for the agents Paseo runs. Its version is the ather-automata release its shared code is copied from: **0.6.1** (`package.json`'s `version`, which `npm run sync` sets from `ather-automata/.claude-plugin/plugin.json` and `npm run sync:check` holds to it). The intents, stages, Next, away windows, packs, traps and decision ledger are the same code: `server/ather/` is a copy of `ather-automata/hooks/`. The Paseo screens lag behind: see Limits for what of 0.1.5–0.3.3 is not shown here yet. What differs is how it hooks into Paseo.

## Install

Paseo 0.11.1 or later, with plugins enabled (Settings → Plugins). Node, git and `gh` on the daemon's PATH.

```bash
paseo plugin install github:AskTinNguyen/ather-mods:paseo/ather-automata
```

It applies to agents created after install whose checkout runs intents (a `docs/intent` folder) or has `.ather/profile.json`. Elsewhere it does nothing. Update with `paseo plugin update ather-automata`.

## What you see

| Claude Code | Paseo |
|---|---|
| `/ather` pane | The **Ather** agent panel: the stage track (Plan → Build → Prove → Ship), proof, a strip with the checklist, workers running and decisions waiting, Needs you, Next, the workers, today in the intent, other work, New intent / Skills / Create, Away. Open it with `/ather`, the composer pill, or Ctrl+K → "Ather". |
| `/ather …`, `/away …` | The same commands, `/ather untrack` included. Replies show as a toast, on the panel and in the agent's timeline. |
| Intent view | Pressing an intent (or `/ather intent <words>`) opens it: where it stands, its proof by session, who else tracks it, today's lines (a press asks what one changed). **Work on this here** tracks it; looking never does. **Stop tracking** undoes it. **Ask about it** asks the agent. |
| Work list (Pick something / Other work) | Grouped by source, each group coloured and foldable: your intents, your assigned GitHub issues, teammates' intents. Every row reads the same: stage glyph (● building, ◐ items met, PR not merged, ✓ ready to close, ‖ parked), title, the owner in their own colour, a small progress bar with its count, and its age. A search box (title, number, area or owner; pressing an owner's name searches for them) narrows it, with "x of y" counts. **Sort** cycles Recent, Ready to close (in stage blocks) and Oldest. **Group** sorts the teammates' intents by Person, Area, Stage or None, in foldable sub-groups (over six start folded), and is remembered for you. Each group's parked intents fold into "‖ Parked" at its end. |
| Band above the prompt | A composer pill per agent: what needs you, a running window, or the tracked intent's stage and items met. |
| Pop-ups | Ather rows in the agent's timeline: held actions, traps with their fix, false build passes, lost merge edits. |
| The squad | Each worker with its avatar (body for its kind, holding what it is doing, a ring for its state), model, what it is doing or what came of it, its steps, how long it took and its tool calls. Read from Claude Code's own record of each worker (`~/.claude/projects/<checkout>/<session>/subagents/`). |
| `status`, `away`, `profile` tools | The same tools, as an MCP server (`mcp__ather-automata__*`) added to each agent and preapproved. `profile` takes `track: "none"` to stop tracking. |

## How the guards work in Paseo

Paseo plugins have no hook before or after a tool call, so:

- **Holds while away.** New Claude agents get *ask* rules for `git push`, `git merge`, `git pull`, `gh pr merge` and `gh api`. With the web pack they also cover deploys, migrations, publishes, secrets and infrastructure, including `npm run` scripts that run them. Ask rules fire even in bypass mode, and Ather answers each prompt itself: refused and parked (P-1, P-2…) when an away window holds it; allowed at once in a non-asking mode (bypass, auto); left to you in default mode. Unreal Editor launches and kills are left to s2-ue-orchestrator's lease; Ather only refuses them when a window holds them.
- **Questions while away** reach Paseo as permission requests. Ather records them in the ledger (D-1, D-2…) and tells the agent to take the recommended option. This works for Codex agents too.
- **Worker brief gate.** An `Agent`/`Task` ask rule lets Ather read each brief before the worker starts: *warn* adds a timeline note, *enforce* refuses it.
- **Proof, traps, merge audit, intent changes and tracking** are read from each finished turn's timeline, not as each command runs. Only the agent's own writes to an intent's `prompt.md` or `log.md` track it (0.1.2). What Claude Code adds to a tool's result for the model is not sent to the agent here: Paseo cannot edit a tool's result, and the follow-up message that stood in for it is gone (0.6.4).
- **Lane context.** Claude Code added the lane state (tracked intent, Editor lock, peers, the away mandate) to every prompt. Here the agent gets a short system note at creation and reads the live state with `mcp__ather-automata__status`; starting an away window tells it to.

## Settings

Settings → Plugins → Ather Automata: the worker brief gate (warn, enforce, off), and hold rules for Claude agents (on).

## Limits

- An agent is a lane: its Paseo agent id stands for the Claude Code session id, and proof is stamped with its first 8 hex. A new top-level agent adopts an away window from one that has ended.
- Agents created before install get neither the tools nor the ask rules; the panel, pill and commands still work for them. Agents whose Claude `settings` option is a file path get the tools but not the ask rules.
- Codex agents get the tools, question deferral and turn reading, but no ask rules: holds apply only when Codex asks on its own.
- If the plugin stops, Claude agents created with its ask rules still prompt for those commands, and the prompts wait for you.
- "Also tracked in … · active Nm ago" can be a little off: `state.mjs` keeps one "last active" time per process, and one plugin process serves every agent.
- A worker's calls in flight are not seen (Paseo has no hook around a worker's tool calls), so the workers list has no "⏳ asking permission", "⏳ waiting on …" or "one call running N min" lines (0.1.9); a worker silent for three minutes reads quiet, as before.
- Not here yet: the newcomer tour toast (the tour is the Next row and `/ather tour`).
- Not here yet: Send where? (0.2.8). A press about an intent another live agent tracks goes to this agent.
- A press that hands the agent a prompt while a turn runs interrupts that turn (Paseo's default for a send); the Claude Code mod queues it until the turn ends (0.2.8).
- Keep the prompt cache warm (0.3.0) is not offered: Paseo's plugin API has no way to read an idle agent's cache without adding a turn to its conversation.

## Develop

```bash
npm install
npm run typecheck
paseo plugin install /absolute/path/to/ather-mods/paseo/ather-automata   # or: paseo plugin reload ather-automata
paseo plugin logs ather-automata
```

- **Shared code.** `server/ather/` is copied from `ather-automata/hooks/` by `npm run sync`; never edit it here. After any change to the Claude Code mod, run `npm run sync`, typecheck, and add the Paseo side of the change if it needs one. `npm run sync:check` (also run by `dev/test-all.mjs`) fails while the copies differ.
- **Pictures.** Plugins cannot render SVG, so `npm run art` draws the mod's artwork (the Ather mark, worker avatars and props from `squad.mjs`) to PNG in `server/art.generated.ts`. The server hands those and GitHub avatars to the app through the `ather.art` RPC.
- **Layout.** `index.server.ts` wires Paseo's hooks: `server/watch.ts` (the silent half), `server/console.ts` (what the panel shows), `server/tools.ts` and `server/bridge.ts` (the MCP tools), `server/agentConfig.ts` and `server/rules.ts` (what new agents get), `server/squad.ts` and `server/transcripts.ts` (the workers). `client/` is the panel, pill, commands, timeline rows and settings; `client/ui.tsx` is the shared look and motion.
- **Quick checks.** `node --import ./server/test-resolve.mjs --experimental-strip-types <file>.mts` loads the TypeScript sources from a scratch script. Set `PASEO_HOME` to a temporary folder so it never writes the live plugin's store.

## Changes

- **0.6.1** Shared code at ather-automata 0.6.1, and the panel catches up with 0.4.0–0.6.0. **Simple and Advanced views**: the button at the panel's foot, or `/ather simple` and `/ather advanced`, kept for you as in the mod (Simple shows the title and status, Needs you, Needs attention, Next and the toggle). **Your branch against origin's base**: each checkout's branch is checked as its panel is built, one check at a time; Needs you shows **Bring origin/main into feat/x** when they no longer merge cleanly, and a line under the status says `Merges cleanly into origin/main · checked 2m ago` or, in warning, `▲ N overlaps with origin/main · see Needs you`. The composer pill shows the tracked intent's stage (`● Build 1/2 · feat-x`) when nothing needs you. Proven by `dev/e2e/paseo.mts` (the server over a real checkout, run by `dev/test-all.mjs`).
- **0.6.0** Shared code at ather-automata 0.6.0: Home's merge line and the stage pill (`buildHome`'s `merge`, `header.merge`, `header.pill`); the panel shows neither yet.
- **0.5.0** Shared code at ather-automata 0.5.0: `collide.mjs`, and Needs you's collision item (`buildHome`'s `collision`), which the Paseo panel does not check for yet; see Limits.
- **0.4.3** Shared code at ather-automata 0.4.3: the pane's modes (`modes.mjs`), which the Paseo panel does not use.
- **0.4.2** Shared code at ather-automata 0.4.2: the overlap check's time budget and the intent behind a base change.
- **0.4.1** Shared code at ather-automata 0.4.1: the overlap check (`overlap.mjs`) and an intent's Branch line. Nothing in the panel uses them yet.
- **0.4.0** Shared code at ather-automata 0.4.0: Home's Simple and Advanced views (the view is remembered per person; Group by now goes through the same helper). The panel does not draw the Simple view yet; see Limits.
- **0.3.3** Shared code at ather-automata 0.3.3 (origin/main 2968ed8), and the version now names it: `npm run sync` takes the mod's version and `sync:check` fails while they differ. Needs Paseo 0.11.1 (below 0.12). The base branch (0.2.7) is passed on: a core or Unreal checkout whose team merges into `develop` (its profile's `baseBranch`, else the remote's default branch) now has pushes to `develop` held while away, and the held labels, the mandate and the away start name it. The web pack already held it. The intent view gains **Where it stands**, read from the intent's own files (0.2.8): "See how the work is going" and a teammate's "See where it stands" open it instead of asking the agent. It also gets **Ask about it** (0.1.6), a press on one of today's lines asks what it changed, and the tracked intent's Next is a press. Tracking replies "Now tracking X. Next: …" (0.3.3). Needs you decides in place (0.2.0): an intent's several decisions wait as one row, the first decision that waits opens with its options as buttons (the recommended one primary), then Explain, Type an answer and Open findings; an answer reads "✓ Decided" for 8 seconds, then folds into "▸ N decided". The work list has 0.1.5's row anatomy, Sort, tidied owner names and **Needs attention** (your intents with every item met, or parked with no reason), and 0.1.9's Group by and Parked fold; Sort replaces the age filter, as in the mod. Workers are drawn under the worker that started them (0.1.9; found from the Agent calls in each worker's own record), "started by" only when that one is not right above, a parent's finished workers past three folded into "+N finished". The team's intents are read from `origin/main` (0.1.5; `origin/<base>` where the team merges into another branch) through git, never touching the working tree or the index, with the checkout's own folders added; origin is fetched in the background at most every 10 minutes (no tags, no FETCH_HEAD, no automatic gc), and the header says how fresh it is ("synced 4 min ago ↻"; pressing it, or Refresh, fetches now). An intent only on origin offers Ask about it, which reads it there with `git show`, in place of Work on this here. See Limits for what is not wired yet.
- **0.1.2** First release, matching ather-automata 0.1.2: the panel, pill, commands, intent view and squad; holds, the decision ledger and the brief gate through Claude ask rules and permission requests; proof, traps, merge audit and tracking read from each turn; the `status`, `away` and `profile` tools over MCP.
