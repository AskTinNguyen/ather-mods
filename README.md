# Ather mods

Claude Code mods for the S2 team. This repository is the `ather` plugin marketplace.

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

Then start a new Claude Code session in your S2 checkout and type `/ather`.

Opening Claude Code in an S2 checkout also offers the mod, through the checkout's `.claude/settings.json`.

On an agent PC, add the weekly report too; its [README](week-calendar/README.md) has the one-time scheduling step:

```bash
claude plugin install week-calendar@ather --scope user
```

## Update

```bash
claude plugin marketplace update ather
claude plugin update ather-automata@ather
claude plugin update week-calendar@ather
```

Restart your sessions afterwards.

## Releasing a change (maintainers)

1. Edit `ather-automata/`, then run `S2_ROOT=<your S2 checkout> node dev/test-all.mjs` (unit tests plus a 138-check end-to-end run against a stand-in engine, on a sandbox copy of that checkout's intents; set `CLAUDE_CODE_TYPES` to type-check too).
2. Check it loads: `claude plugin validate ather-automata`.
3. Bump `version` in both `ather-automata/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`, and add a line under Changes in the mod's README.
4. Open a PR to `main`. Teammates get it on their next update.

For `week-calendar/`, run `node --test "week-calendar/scripts/test/*.test.mjs"`, `claude plugin test week-calendar` and `claude plugin validate week-calendar`, then bump its version in the same two places and note the change in its README.

The mod depends on S2 repository pieces that ship with S2 itself: the `ather-tour` skill and the `Area`, `Owner` and `Issue` lines of intent prompts. Some end-to-end checks name real S2 intents, so they follow the checkout's state.
