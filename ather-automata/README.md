# Ather Automata

Working the S2 way with Claude Code: what needs you, what to do next, and a safe pair of hands while you are away.

## In 30 seconds

- **Type `/ather`** whenever you wonder what to do. What needs you comes first, then the next step for your work, ready to send.
- **New here?** `/ather tour` walks you through it in six short steps and ends with your first piece of work started. In a hurry, skip it; Ather just asks your role.
- **Leaving?** `/away tonight` (or `8h`, `until 9am`, `until done`). The session keeps working; merges wait for you. When you are back, `/ather` → **I'm back: see what happened**.

## What you see

| Where | What |
|---|---|
| Terminal | `/ather` opens one pane: where your work is (Plan ✓ ─ Build ● ─ Prove ○ ─ Ship ○) and the proof so far, what needs you, then Next, then other work you could pick up. Enter hands a row to the session; a decision opens in place with its options as buttons, so you answer it where it is shown. |
| Desktop app | `/ather` opens the same pane in the side panel; click a row to hand it to the session. |
| Above the prompt | One line: what needs you, a running window, or just the name; then ☾ away, ⤢ open the pane, ✕ hide it until something is new. |
| Pop-ups | A known trap with its fix, a build that really failed, a merge that dropped your edits, a worker gone quiet, a thin worker brief. |

On a PC that also runs [week-calendar](../week-calendar/README.md), the pane's line under the title adds this week's figures: PRs merged and productive agent time.

## What to work on

Each session works on one intent. A new session offers to continue the one you last worked on. With nothing tracked, Ather offers one list: your open intents, then the GitHub issues assigned to you that have no intent yet (high priority first), then teammates' intents you could follow (read-only: their decisions stay theirs).

**Tracking.** Looking at an intent never tracks it: a row, or words that name one, opens its view, and **Work on this here** there makes it this session's intent (so do Next's Continue and Pick up, and `/ather intent <exact name>`). **Stop tracking** in the view, or `/ather untrack`, undoes it; the proof recorded so far stays with the intent. A session also tracks the intent it runs: writing that intent's `prompt.md` or `log.md` from the main conversation (a new `prompt.md` switches to the new intent); a worker's writes never do. Several sessions may track one intent; its view then says so ("Also tracked in 1 other session · active 5m ago"). After `/clear`, or when a new session takes over an away window, Ather says which intent is still tracked.

Clicking an issue opens its card: **Start an intent**, **Open on GitHub** or **Copy link**. Starting one asks the session to check for overlapping work first (the issue preflight), then draft an intent linked to it (`- Issue: #28887`) and show you the plan before anything is built. Ather reads your issues with `gh` and never writes to GitHub. `/ather issues` lists them; `/ather issue 28887` or `#28887` starts one.

## Going away

- **Allowed** without asking: pushing branches and opening draft PRs and PRs to main.
- **Held** until you review the window: merges into main (also through `gh api`) and pushes to main, however they are spelled. Each command is judged on the branch of the folder it runs in, so pushing your feature worktree is never held.
- **Questions** the session would ask go to a decision ledger with its choice and reasons, while you are away and after the window ends, until you type anything.
- **Coming back:** "I'm back" ends the window and walks you through every decision (keep, undo, talk it through) and every held action (run it now, or drop it). A new session the next morning picks up last night's window.

## Proof

Ather reads evidence from tool output, never from what the session says: an S2Editor build's own Result line, a test run whose tests passed (no tests, a failure or a non-zero exit is a fail), a started PIE or test simulation run, and a read-back from the server that was written to. A tech artist's own Editor check is `/ather checked`. Proof is kept with the intent for a day, so yesterday's build still counts this morning; each record names the session that produced it, and the Intent view names any other session's. Until you say your role, any role's proof counts.

## Commands

| Command | Does |
|---|---|
| `/ather` | What needs you and what is next |
| `/ather tour`, `/ather skip` | The tour, or skip it and just say your role |
| `/ather pick [words]`, `/ather intent <name>` | Everything open; an exact intent name works on it here, other words show the intent they match |
| `/ather untrack` | Stop tracking this session's intent (not while an away window runs) |
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

Settings: `briefGate` (`warn`, `enforce` or `off`) for worker briefs that lack paths, acceptance checks or the shared-tree rule; `repos` for more checkouts this session works with (below).

## Several repositories

One session can work with several checkouts, its **workspace**: the checkout it is opened in, the folders the `repos` setting names (separated by `;` or new lines, absolute or relative to the session folder), and, for a session opened in a folder that is not itself a checkout, each checkout directly inside it. At most 8.

- **One pane.** Everything open lists the intents, assigned issues and PRs of every workspace checkout that has `docs/intent`, each row with its repository's name, dimmed after the title, once there is more than one. The same slug in two repositories is two rows: `login` here, `web/login` there; `/ather intent web/login` and `/ather issue web#7` name one exactly. Each checkout's main is fetched in turn; the sync line shows the least recently synced.
- **Commands by checkout.** `cd ../web && npm test`, or `git -C ../web …`, is read with web's pack: its proof counts for web, and while you are away it is held by web's rules as well as the window's (a production deploy in web is held even from an S2 session).
- **Tracking anywhere.** Work on this here on another checkout's intent, or writing its `prompt.md` or `log.md`, tracks it there: its view, proof, PRs, away ledger and peers come from that checkout, and the session shows as live there too.
- **Kept per repository** (named by the origin URL, so every worktree of a repository shares them): issue lists, PR states, an intent's proof, today's changes and "Continue …".
- With one checkout, nothing changes.

## Web projects

The same mod runs in web app repositories (Node and TypeScript first), piloted on Thính (AskTinNguyen/han-viet). The pane, Plan → Build → Prove → Ship, Next, away windows, the decision ledger, issues and the worker squad are the same; what counts as proof, what is held and what Next asks for come from a **pack** for the kind of project:

- **Which pack:** the repository's `.ather/profile.json` (`"pack": "web"` or `"unreal"`), else markers (`*.uproject` → Unreal; `package.json` or `pyproject.toml` → web), else the core alone. Read once per session. S2 checkouts get the Unreal pack and see exactly what they saw before.
- **Profile format** (v1, as han-viet's `tests/ather-profile.test.mjs` checks it):

  ```json
  {
    "version": 1,
    "pack": "web",
    "gates": [
      { "id": "test", "command": "npm test", "proofs": ["tests", "build"], "proves": "the full suite" },
      { "id": "lint", "command": "npm run lint", "proofs": ["lint"] },
      { "id": "build-next", "command": "npm run build:next", "proofs": ["build", "typecheck"] },
      { "id": "ui", "command": "npm run ui:verify", "proofs": ["ui"] }
    ],
    "production": { "host": "vercel", "branch": "main", "deployment": "how the deployment is checked", "probe": { "url": "https://…", "expectStatus": 200 } },
    "mergePolicy": "with-proof",
    "devPorts": { "base": 3100, "perWorktree": 10, "env": "UI_VERIFY_PORT" }
  }
  ```

  Optional: `"required"` (the rungs a merge needs; default every declared proof but production) and `"areas"`. Without a profile, `npm test`, `lint`, `typecheck` and `build` scripts stand in for gates.
- **Proof:** five rungs, read from tool output only: `tests`, `lint` (lint and typecheck), `build`, `ui`, `prod`. A gate's command (or an `npm run` script, or the tool itself: `node --test`, vitest, jest, Playwright, `tsc`, ESLint, `next build`, vinext and Vite builds) passes on exit 0 with its own pass counts and no failures; a failure count or a non-zero exit fails it; a piped run is judged on its counts alone. `prod` is the deployment's commit status through `gh api`, `vercel inspect`, or a probe of the profile's URL. Roles: Engineer (tests, lint, build), Designer (the browser check), Product (build and the browser check).
- **Merge policy:** `with-proof` lets a merge into `main` through, even while you are away, once every required rung has passed in tool output in this session; otherwise it is held as in S2. Ship then asks for the production check. Without the policy, merges wait for you.
- **Held while away:** production deploys (`vercel --prod`, `vercel deploy --prod`, `wrangler deploy`), migrations against a non-local database, env and secret changes (`vercel env add/rm`, `wrangler secret`, `gh secret`, and the same through `gh api`), `npm publish`, `terraform apply`, and pushes to main, inside chained commands and `npm run` scripts too.
- **Traps** with their fix: a port in use, POSIX env syntax in npm scripts on Windows, hydration mismatch, a stale `.next` or Vite cache, lockfile drift, Node version against `engines`, a missing `NEXT_PUBLIC_*`, missing Playwright browsers, a held `.next` lock.
- **Create** offers `frontend-design`, `run`, `code-review`, `security-review` and `simplify`.
- **Local files:** lane heartbeats, and an away ledger when no intent is tracked, go to `.ather/local/` (add it to `.gitignore`); debriefs to `docs/intent/<slug>/debrief.md`.

## Limits

- Where a surface has no pane (the mobile app), `/ather` asks one question instead; option descriptions may not show there, so labels stand alone.
- Your role, the tour, trap counts and the issue list are kept on your machine, not shared across the team.
- Several repositories are the Claude Code mod's for now: the Paseo version still works with one checkout.
- It never merges, commits or pushes on its own. It is a safety net, not a permission system, and it does not stop tree-rewriting git in the shared checkout (`deny_root_paths.py` does that, outside this plugin).

## For maintainers

One hooks module (`hooks/ather.mjs`) made of two halves. `watch.mjs` protects work and has no interface beyond pop-ups; `console.mjs` draws. They share state only through `state.mjs`, the one owner of every stored value, which applies changes one at a time. The pure logic is split by concern: `model.mjs` (intents, stages, next step), `guards.mjs` (shell and MCP checks, traps), `away.mjs` (window rules), `issues.mjs` (GitHub issues), `home.mjs` (what the console shows), `decide.mjs` (answering a decision in place: its answers, what each hands the session, this session's answers), `team.mjs` (the team's intents from `origin/main` and the background fetch), `worklist.mjs` (sort, stage blocks, Needs attention, owner names, row cells), `rows.mjs` (the pane's look, and the lists it draws: Needs you, Everything open, Home's preview), `workers.mjs` and `inflight.mjs` (the workers the watch half saw, and every tool call in flight, per loop), `crew.mjs` (the workers as listed, and the tree they are drawn in), `crew-rows.mjs` (the workers drawn). `workspace.mjs` finds a session's checkouts; `state.laneAt` gives each its own pack and repository, and the store keys that belong to a repository carry its id. Background hooks never get in the way of the calls they watch; the mod shows state and routes, and the session does the talking.

Packs (`hooks/packs/`): `unreal.mjs` (S2), `web.mjs` and `core.mjs`, chosen by `packs/index.mjs`; `shell.mjs` reads command lines for all of them. A pack is a plain object; the pure modules take it as their last parameter, defaulting to the Unreal pack.

Tests: `tests/ather.test.mjs`, `tests/acceptance.test.mjs` and `tests/web.test.mjs` (with outputs captured from han-viet under `tests/fixtures/web/`) run under `node --test` once `dev/test-all.mjs` has linked the test kit; `tests/plugin.test.ts` runs under `claude plugin test ather-automata`. `dev/e2e/repos.mjs` drives the module over real git checkouts (a parent folder with an Unreal and a web checkout, local bare origins) and needs nothing else. An end-to-end run in the marketplace repo (`dev/test-all.mjs`) drives the real code against a stand-in engine that answers dialogs the way the app does and lays out every pane at 72 and 110 columns; with `HANVIET_ROOT` set to a han-viet checkout it lays out the web pane too, and `--layouts <dir>` writes every layout for a diff.

## Changes

- **0.2.1** Several repositories. What is kept per repository (issue lists, PR states, an intent's proof, today's changes, "Continue …") is named by the origin URL, so an S2 checkout and a web repository on one PC no longer show each other's issues, mix PR numbers or share proof for an intent of the same name; what was kept before carries over once. A session's workspace (its checkout, the new `repos` setting, or the checkouts inside the folder it is opened in) shows in one pane: every checkout's intents, issues and PRs, each with its repository's name. A command is judged and proved by the checkout it runs in, with that checkout's pack, and an intent in another checkout can be tracked there. One checkout looks and behaves as before; the Paseo version keeps one checkout.
- **0.2.0** Decide in place. In Needs you the first decision that waits is opened: its whole question, then its options as buttons, read from the finding itself (the `**Options:**` list with `- A (recommended): …`, or inline `(a) … (b) …` with `Recommendation: (a)`), the recommended one primary and marked, then Explain, Type an answer and Open findings ›. An option hands the session "Decide F-n on <intent>: A — <the option>" with the instruction to record it the intent skill's way and not ask again; the row shows "✓ Decided: A" for 8 seconds, then folds into "▸ N decided" (this session's answers, until the files read them resolved; not kept across a reload). Explain asks about it without deciding; Type an answer opens a text field under the row (the question dialog's Other where the surface has no field, as on mobile); other decisions are one line each and open on a press, one at a time; an intent with several keeps its one folded row. "Make it a rule?" answers the same way (Make it a rule / No, leave it). A finding whose Resolution is filled is closed whatever its heading says, so already-decided findings no longer count. Everything open's Search opens a text field (the dialog only where there is none); `/ather find <words>` is unchanged.
- **0.1.9** Who waits on whom, and a team list that groups. Workers are drawn under the worker that started them ("started by" only when that one is not right above, "(finished)" when it is done; past three finished, "+N finished"). Each tool call is tracked while it is in flight, so a long build, PIE run or foreground worker is never shown as quiet and never raises the stuck-permission pop-up, while a call waiting on the permission dialog reads "⏳ asking permission: …" and raises the pop-up once it has waited ten minutes; a worker says what it waits on, from facts only ("⏳ waiting on <worker>", "⏳ <a shell or Monitor call's own description>" past a minute, with the Editor lock file's first line when the command names it), and "⚠ one call running N min" past 25 minutes. The heading reads "Workers · Running N · Waiting on M" (waiting on only when some are); Claude Code's pending workers read "queued", and a worker's question to you reads "asking you". In Everything open, Group (g in the terminal) sorts the teammates' intents by Person (the default), Area, Stage or None, in foldable sub-groups with counts (more than six start folded), remembered for you; each group's parked intents fold into "‖ Parked · N" at its end; a search shows "x of y" on the heads and opens the sub-groups and Parked blocks that hold its matches.
- **0.1.8** Desktop work rows line up: the progress bar is drawn as a small SVG in exact pixels (its text glyphs took the font's widths and ran into the count, so 3/3 read as 8/3), the count and age sit at their columns' right edges with room for wider digits, and a long title is clipped in its own box instead of pushing the right-hand columns off the pane. The terminal is unchanged.
- **0.1.7** Avatar frame: a running worker's avatar is a round badge on the pane again in the dark theme, not in a white square (its animated frame now takes the app's colour scheme).
- **0.1.6** Ask about any intent, even one this checkout does not have yet: its view offers Ask about it (the session reads it from `origin/main` with `git show` and `git log`, read-only, and says what it is for, who owns it, its stage, checklist, open decisions and next step). An intent only on main offers it in place of Work on this here, which needs the folder here (pull main first); a teammate's "See where it stands" reads from main too.
- **0.1.5** The team's real state: intents are read from `origin/main` through git (never touching the working tree or the index) with the checkout's own folders added and tagged `local`, each dated by its folder's last commit there instead of when someone last pulled; origin's main is fetched in the background (`git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main` with no FETCH_HEAD, submodules or automatic gc, `GIT_OPTIONAL_LOCKS=0`, at most every 10 minutes, one at a time; a git lock in the way is named and waited out) and the header says how fresh it is ("synced 4 min ago ↻", ↻ fetches now). Sort (Recent, Ready to close in stage blocks, Oldest) replaces the age chips; Needs attention lists your own intents with every item met or parked without a reason; owner names are tidied (`LamPhung-Art` is Lam Phung, `Cinematic` is "Tien Dang · Cinematic", no Owner falls back to the first committer); every work row has one anatomy (stage glyph, title, mini progress bar and count, age, owner) in aligned columns; an intent's several decisions wait as one row; Home previews four teammates' intents then "+N more ›"; lime is kept for what needs you.
- **0.1.4** The work list, by source: Everything open is three groups, each in its own colour and foldable (your intents, your assigned issues, teammates' intents), with a Search button (title, issue number, area or owner; `/ather find <words>` too) and an age filter (any time, 7, 30, 90 days, by when an item last changed). A teammate's name follows the intent's title in its own colour, dimmed; no two teammates share one. The count and the fold stay when you filter.
- **0.1.2** Track guard: looking at an intent never tracks it (rows and matching words open its view; Work on this here tracks it), Stop tracking and `/ather untrack` undo it with the proof kept, only a session's own orchestration tracks by writing (its main conversation writing an intent's prompt.md or log.md), a second session on an intent sees "Also tracked in …", proof names the session that produced it, and /clear or an adopted window says which intent is still tracked.
- **0.1.1** Every worker counted, true clocks: the worker list shows every agent Claude Code lists (those another worker started too), a worker's clock ends at its turn's end, a worker running before Ather loaded takes its start and model from Claude Code's record, and a worker's kind comes from its description first.
- **0.1.0** Web projects: one plugin with packs. S2's behaviour moved unchanged into the Unreal pack; a web pack (piloted on Thính, han-viet) reads `.ather/profile.json` gates as proof from tool output, holds production deploys, migrations, secrets, publishes and infrastructure applies while you are away, merges with proof under `with-proof`, knows nine web traps, and offers web skills under Create.
- **0.0.7** This week's figures from week-calendar (PRs merged, productive agent time) on the pane's meta line, when that plugin runs on the PC.
- **0.0.4** ✦ Create: the skills that make content in the Unreal Editor, grouped by what is made (VFX and look, characters and animation, AI and encounters, enemies, levels and cinematics, audio), led by what they do, three per group with More for the rest, ordered by role; each asks what you want first, records an intent and respects the Editor lock.
- **0.0.3** The intent at a glance: after a turn that changed the intent, one line above the prompt (ticked A12 · new decision F-11) with See; the Intent view lists today's changes (✓ done, ◆ yours, ✎ changed) and explains any of them on a click.
- **0.0.2** The worker squad: each background worker with an avatar (body and colour for its kind, a ring for its state, the prop it holds for what it is doing), a trail of what finished workers did, a summary strip (checklist, workers running, decisions waiting on you) and the proof in colour.
- **0.0.1** First shared release. The pane (terminal and desktop side panel) with what needs you, Next, your intents and assigned GitHub issues, New intent and a curated Skills list; issue cards (start an intent, open on GitHub, copy link); the band with away, open and close; away windows with held merges and a decision ledger; evidence read from tool output; the newcomer tour.
