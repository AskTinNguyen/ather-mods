# Ather mods

Claude Code mods for the S2 team. This repository is the `ather` plugin marketplace, and has the same mods as [Paseo](https://paseo.sh) plugins under [`paseo/`](paseo/).

| Mod | What it does |
|---|---|
| [ather-automata](ather-automata/README.md) | Type `/ather` to see what needs you and what to do next. New here? `/ather tour`. Leaving? `/away tonight`. |
| [week-calendar](week-calendar/README.md) | For agent PCs: a weekly calendar of every session and a weekly report (PRs merged, productive agent time) pushed to the team's agent-reports repo. Install it only where sessions should be reported. |

## Install (once)

Claude Code 2.1.287 or later:

```bash
claude plugin marketplace add AskTinNguyen/ather-mods
claude plugin install ather-automata@ather --scope user
```

Then start a new Claude Code session in your S2 checkout and type `/ather`. In a repository without intents (no `docs/intent` folder), `/ather` offers to set them up; the mod's [README](ather-automata/README.md#setting-up-a-repository) says what that adds.

Opening Claude Code in an S2 checkout also offers the mod, through the checkout's `.claude/settings.json`.

On an agent PC, add the weekly report too; its [README](week-calendar/README.md) has the one-time scheduling step:

```bash
claude plugin install week-calendar@ather --scope user
```

## On Paseo

For agents that Paseo runs (Paseo 0.10.2 or later, plugins enabled), install the Paseo versions from this repository:

```bash
paseo plugin install github:AskTinNguyen/ather-mods:paseo/ather-automata
```

```bash
paseo plugin install github:AskTinNguyen/ather-mods:paseo/week-calendar
```

They behave the same, on Paseo's surfaces: an Ather panel per agent, `/ather` and `/away`, a composer pill, and notes in the agent's timeline. Each README says what differs: [ather-automata](paseo/ather-automata/README.md), [week-calendar](paseo/week-calendar/README.md) (not yet run under Paseo). To update, run `paseo plugin update ather-automata`.

## Update

```bash
claude plugin marketplace update ather
claude plugin update ather-automata@ather
claude plugin update week-calendar@ather
```

Restart your sessions afterwards.

## Releasing a change (maintainers)

1. Edit `ather-automata/`, then run `S2_ROOT=<your S2 checkout> HANVIET_ROOT=<a han-viet checkout> node dev/test-all.mjs` (unit tests plus an end-to-end run against a stand-in engine, on a sandbox copy of that checkout's intents; set `CLAUDE_CODE_TYPES` to type-check too; `HANVIET_ROOT` adds the web pane; `--layouts <dir>` writes every pane layout for a diff). Without `S2_ROOT` the S2 end-to-end run is skipped and says so, and the rest still runs: this is for people who do not work on the game and have no S2 checkout; a change to what an S2 session sees still needs one run with it. Afterwards `node --test ather-automata/tests/*.test.mjs` runs the unit tests alone, and `claude plugin test ather-automata` loads the module in the engine.
2. Check it loads: `claude plugin validate ather-automata`.
3. Bump `version` in both `ather-automata/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`, and add a line under Changes in the mod's README.
4. Bring the Paseo version along. In `paseo/ather-automata`:
   - run `npm run sync`, plus `npm run art` if the artwork in `squad.mjs` changed;
   - run `npm run typecheck`;
   - add the Paseo side of any new behaviour (`server/watch.ts`, `server/console.ts`, the panel).

   `dev/test-all.mjs` fails while the shared copies differ.
5. Open a PR to `main`. Teammates get it on their next update.

For `week-calendar/`, run `node --test "week-calendar/scripts/test/*.test.mjs"`, `claude plugin test week-calendar` and `claude plugin validate week-calendar`, then bump its version in the same two places and note the change in its README. After any change to its scripts, run `npm run embed` in `paseo/week-calendar`.

The mod depends on S2 repository pieces that ship with S2 itself: the `ather-tour` skill and the `Area`, `Owner` and `Issue` lines of intent prompts. Some end-to-end checks name real S2 intents, so they follow the checkout's state.
