# week-calendar

A Claude Code plugin that turns each agent PC's session logs into a weekly calendar and an effectiveness report: **PRs merged** and **productive agent time**. Every Monday each PC pushes last week's report to [AskTinNguyen/agent-reports](https://github.com/AskTinNguyen/agent-reports), where a GitHub Action builds the team roll-up.

## Install on an agent PC

Needs Node 20+, git, and the GitHub CLI logged in (`gh auth login`) with read access to the repos the agents work in and write access to agent-reports.

Install it only on PCs whose sessions should be reported: every week it pushes the full session data (prompts, titles, commits) to the team's reports repo. It is a separate plugin from ather-automata for that reason.

```bash
claude plugin marketplace add AskTinNguyen/ather-mods
```

```bash
claude plugin install week-calendar@ather --scope user
```

Start a Claude Code session once: the plugin writes its settings to `~/.calendar/config.json` and copies its scripts to `~/.calendar/bin/`. Check that a weekly run works without pushing, then schedule it:

```bash
node ~/.calendar/bin/weekly.mjs --dry-run
```

```bash
node ~/.calendar/bin/schedule-weekly.mjs
```

That creates a Task Scheduler task, "week-calendar weekly report", Mondays 06:00 for the current user; `--remove` deletes it.

### Settings

Set them in Claude Code's plugin config menu (each is optional):

| Setting | Default | What it does |
| --- | --- | --- |
| Machine name | the computer name | The PC's name in team reports |
| Operator | your global git user.name | Who runs the PC |
| Available hours per week | 168 | Denominator of productive time |
| Reports repo | `https://github.com/AskTinNguyen/agent-reports.git` | Where the weekly report goes. `owner/name` means a GitHub repo; publishing refuses a repo whose name does not mention reports |
| GitHub login | the account `gh` is signed in as | Tells your merged PRs from teammates' PRs you committed to |
| Ignored folders | Temp folders | Sessions in these folders are left out |
| Extra git emails | none | Commit emails that count as this PC's, e.g. the AI agent account |

## Use it

- "what did I do this week" or "write my weekly report": the week-calendar agent rebuilds the calendar, Claude writes a three-line report, then asks the weekly survey (rating, most valuable and most wasted session, why no-commit sessions stopped) and publishes the report.
- "exclude the git polling session from the week calendar" (or "include it"): changes what counts, permanently.
- The calendar is `~/.calendar/latest.html`. The first time, the agent asks for a style: dark or light, an accent color, color by project or task type, and the first day of the week.

## How it measures

- **Commits** are credited to the session (or subagent) whose `git commit`, `rebase`, `merge`, `pull`, `cherry-pick`, `revert` or `am` call made them: the hash git printed, or the commits created while that call ran by this PC's git identities (the repo's `user.email` and Extra git emails). A pull or merge brings in teammates' commits dated inside the call; those are not yours. This holds when parallel sessions share a repo. A commit no call claims is credited by time only when exactly one session was active in that repo.
- **Productive**: a session that pushed successfully, or whose commits are on a remote branch. Main takes no direct commits, so a push is where work becomes productive.
- **PRs merged**: PRs merged that week (GitHub search) whose commits include one this PC made, in that week or the four before. Those whose author is your GitHub login are **yours** (`metrics.prsAuthored`); the rest are teammates' PRs you committed to. A session that fed several PRs shares its agent hours and cost between them.
- **Busy time**: every gap between consecutive log records of a session or its subagents, unless the later record starts a turn; one step counts for at most 90 minutes. **Waiting on a person**: from the record before a typed prompt to that prompt, up to 8 hours.
- **Outliers**: a session of 4+ hours where 80%+ of turns started by themselves (schedules, loops, plugin or SDK drivers) is excluded from totals.
- **Routine runs**: a commitless session of 3 minutes or less whose title recurs 5+ times that week (butlers, schedulers), or in which nobody typed, is automated: left out of totals and no-commit counts, counted as automated hours, and drawn as ticks on each day's edge.
- **The calendar** leads with agent-busy hours. With one project it colors sessions by workstream (sessions sharing a PR or a title); pieces of a session under 30 minutes apart are one bar; clicking a bar opens its details; on a phone it shows one day at a time.
- Weeks in reports are ISO weeks (Monday start) in the PC's local time.

## Files

| Path | What it is |
| --- | --- |
| `~/.calendar/latest.html` | This week's calendar |
| `~/.calendar/reports/<isoWeek>.json` | Weekly snapshot, kept after Claude Code deletes old logs |
| `~/.calendar/agent-reports/` | Clone of the reports repo |
| `~/.calendar/survey/<isoWeek>.json` | Survey answers |
| `~/.calendar/logs/` | Weekly job logs |

## Develop

```bash
node --test "scripts/test/*.test.mjs"
```

```bash
claude plugin test .
```

```bash
claude plugin validate .
```

## Changes

- **0.3.0** Calendar redesign: full width, routine runs as ticks, one bar per stretch of a session, workstream colors, details in a side drawer, one-day view on phones, agent-busy headline. Commits a pull or merge brought in are no longer credited by timing unless they carry this PC's git identity; merged PRs split into yours (new GitHub login setting) and teammates' PRs you committed to; a session's hours are shared across the PRs it fed. Reports repo accepts `owner/name` and refuses a repo that is not a reports repo.
- **0.2.0** Joins the `ather` marketplace. Commits credited to the session (or subagent) whose git call made them; push and merged-PR status; busy, productive, waiting and idle machine hours; automated sessions left out of totals; weekly survey; secret-scanned weekly report pushed to agent-reports; Monday scheduled job.
- **0.1.0** The weekly calendar: one block per session, commits and changed files, no-commit sessions, hours per project with parallel sessions counted once.
