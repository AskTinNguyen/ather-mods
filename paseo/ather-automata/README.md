# Ather Automata for Paseo

The [ather-automata](../../ather-automata/README.md) mod as a [Paseo](https://paseo.sh) plugin: what needs you, what to do next, and a safe pair of hands while you are away, for the agents Paseo runs. It matches ather-automata **0.1.2**. The intents, stages, Next, away windows, packs, traps and decision ledger are the same code: `server/ather/` is a copy of `ather-automata/hooks/`. What differs is how it hooks into Paseo.

## Install

Paseo 0.10.2 or later (below 0.11), with plugins enabled (Settings → Plugins). Node, git and `gh` on the daemon's PATH.

```bash
paseo plugin install github:AskTinNguyen/ather-mods:paseo/ather-automata
```

It applies to agents created after install whose checkout runs intents (a `docs/intent` folder) or has `.ather/profile.json`. Elsewhere it does nothing. Update with `paseo plugin update ather-automata`.

## What you see

| Claude Code | Paseo |
|---|---|
| `/ather` pane | The **Ather** agent panel: the stage track (Plan → Build → Prove → Ship), proof, a strip with the checklist, workers running and decisions waiting, Needs you, Next, the workers, today in the intent, other work, New intent / Skills / Create, Away. Open it with `/ather`, the composer pill, or Ctrl+K → "Ather". |
| `/ather …`, `/away …` | The same commands, `/ather untrack` included. Replies show as a toast, on the panel and in the agent's timeline. |
| Intent view | Pressing an intent (or `/ather intent <words>`) opens it: where it stands, its proof by session, who else tracks it, today's lines. **Work on this here** tracks it; looking never does. **Stop tracking** undoes it. |
| Band above the prompt | A composer pill per agent: what needs you, a running window, or the stage. |
| Pop-ups | Ather rows in the agent's timeline: held actions, traps with their fix, false build passes, lost merge edits. |
| The squad | Each worker with its avatar (body for its kind, holding what it is doing, a ring for its state), model, what it is doing or what came of it, its steps, how long it took and its tool calls. Read from Claude Code's own record of each worker (`~/.claude/projects/<checkout>/<session>/subagents/`). |
| `status`, `away`, `profile` tools | The same tools, as an MCP server (`mcp__ather-automata__*`) added to each agent and preapproved. `profile` takes `track: "none"` to stop tracking. |

## How the guards work in Paseo

Paseo plugins have no hook before or after a tool call, so:

- **Holds while away.** New Claude agents get *ask* rules for `git push`, `git merge`, `git pull`, `gh pr merge` and `gh api`. With the web pack they also cover deploys, migrations, publishes, secrets and infrastructure, including `npm run` scripts that run them. Ask rules fire even in bypass mode, and Ather answers each prompt itself: refused and parked (P-1, P-2…) when an away window holds it; allowed at once in a non-asking mode (bypass, auto); left to you in default mode. Unreal Editor launches and kills are left to s2-ue-orchestrator's lease; Ather only refuses them when a window holds them.
- **Questions while away** reach Paseo as permission requests. Ather records them in the ledger (D-1, D-2…) and tells the agent to take the recommended option. This works for Codex agents too.
- **Worker brief gate.** An `Agent`/`Task` ask rule lets Ather read each brief before the worker starts: *warn* adds a timeline note, *enforce* refuses it.
- **Proof, traps, merge audit, intent changes and tracking** are read from each finished turn's timeline, not as each command runs. Only the agent's own writes to an intent's `prompt.md` or `log.md` track it (0.1.2). What Claude Code added to a tool's result for the model (a piped build that really failed, a merge that lost edits) is sent once as a follow-up message after the turn.
- **Lane context.** Claude Code added the lane state (tracked intent, Editor lock, peers, the away mandate) to every prompt. Here the agent gets a short system note at creation and reads the live state with `mcp__ather-automata__status`; starting an away window tells it to.

## Settings

Settings → Plugins → Ather Automata: the worker brief gate (warn, enforce, off), hold rules for Claude agents (on), and the follow-up message (on).

## Limits

- An agent is a lane: its Paseo agent id stands for the Claude Code session id, and proof is stamped with its first 8 hex. A new top-level agent adopts an away window from one that has ended.
- Agents created before install get neither the tools nor the ask rules; the panel, pill and commands still work for them. Agents whose Claude `settings` option is a file path get the tools but not the ask rules.
- Codex agents get the tools, question deferral and turn reading, but no ask rules: holds apply only when Codex asks on its own.
- If the plugin stops, Claude agents created with its ask rules still prompt for those commands, and the prompts wait for you.
- Not here yet: the issue card (Open on GitHub, Copy link; issues start from the Work list) and the newcomer tour toast (the tour is the Next row and `/ather tour`).

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

- **0.1.2** First release, matching ather-automata 0.1.2: the panel, pill, commands, intent view and squad; holds, the decision ledger and the brief gate through Claude ask rules and permission requests; proof, traps, merge audit and tracking read from each turn; the `status`, `away` and `profile` tools over MCP.
