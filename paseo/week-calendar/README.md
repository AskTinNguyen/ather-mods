# week-calendar for Paseo

The [week-calendar](../../week-calendar/README.md) plugin (0.3.0) for [Paseo](https://paseo.sh): a weekly calendar of every Claude Code session and a weekly report (PRs merged, productive agent time) pushed to the team's agent-reports repo. The scripts that read the session logs, build the calendar and publish the report are the same ones (`week-calendar/scripts/`, embedded in `server/scripts.generated.ts`). Paseo's Claude agents write the same `~/.claude/projects/**/*.jsonl` logs, so they are counted like any other session.

**Not yet run under Paseo.** It type-checks and the scripts' own tests pass, but it has not been installed on a Paseo host yet. Try it on one agent PC first and report what breaks.

Install it only on PCs whose sessions should be reported: publishing pushes the full weekly session data (prompts, titles, commits; secrets redacted) to the team's agent-reports repo.

## Install on an agent PC

Paseo 0.10.2 or later (below 0.11), with plugins enabled. Node 20+ on the daemon's PATH, git, and `gh auth login` with read access to the agents' repos and write access to agent-reports.

```bash
paseo plugin install github:AskTinNguyen/ather-mods:paseo/week-calendar
```

When the plugin starts, and whenever its settings change, it writes `~/.calendar/config.json` and copies the scripts to `~/.calendar/bin/`, as the Claude Code plugin does at session start.

## Use it

- **Sidebar → Week calendar**: Build this week (PRs merged with their authors, productive time, agent-busy and waiting hours, projects, no-commit and excluded sessions), Publish (dry run), Publish… (asks first), and Schedule weekly job (Task Scheduler, Mondays 06:00, `weekly.mjs`; removing it asks first).
- **`/weekly` in an agent** stands for "what did I do this week": the agent titles untitled sessions, rebuilds the calendar, writes the three-line report, asks the weekly survey, saves it and publishes.
- **Settings → Plugins → week-calendar**: machine name, operator, available hours, reports repo, GitHub login, ignored folders, extra git emails, and the calendar style (theme, accent, colour by, week start).

## Differences

- The Claude Code plugin registers a restricted `week-calendar` subagent and a tool guard that keeps it to the scripts and `~/.calendar`. Paseo plugins cannot register subagents, so `/weekly` gives your agent the same steps with the same limits written into its instructions; the limit is not enforced.
- The calendar style is a setting; the Claude Code plugin's agent asks for it and keeps it in its memory.
- "What did I do this week" does not trigger on its own: type `/weekly`.
- Excluding or including a session: ask the agent to edit `~/.calendar/excluded.json` (`{ "exclude": [ids], "include": [ids] }`) and rebuild.

## Develop

```bash
npm install
npm run typecheck
npm test              # the scripts' own tests, in week-calendar/scripts/test
npm run embed         # after any change to week-calendar/scripts, regenerate server/scripts.generated.ts
```

`npm run embed:check` (also run by `dev/test-all.mjs`) fails while the embedded scripts differ from `week-calendar/scripts`.

## Changes

- **0.3.0** First release, matching week-calendar 0.3.0: the Week calendar screen, `/weekly`, the settings, and the scripts installed to `~/.calendar/bin`.
