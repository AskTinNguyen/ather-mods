# Ather Board

The team's intents as a project board that helps you act: what is yours to do now, what is stuck team-wide, where everything stands, how intents map onto the game's modules, and each person's and area's load. It reads every intent on `origin/main` (and the checkout's own drafts) the way [Ather Automata](../ather-automata/README.md) does. It changes nothing itself: every action is handed to the session, which asks you before it writes, commits or messages anyone.

## In 30 seconds

- **`/board`** opens the board in the session on **For you**: what is yours to act on, and Sonnet's suggestions for you and the team. Triage, Modules, Table, Open items, People and Areas are a tab away.
- **See what collides before it hurts.** Triage's **Colliding** lists open intents whose branches change the same lines as `main` or as each other: which two, which files and lines, and each side's version. Press one for what to do (bring `main` in, or a drafted note to the other owner).
- **Ask** it anything in the box at the top ("what is blocking combat?"): Sonnet answers in a line or two and cuts the board to what it means. `/board ask <question>` does the same.
- **Press an intent** to open it in place: its decisions with their options as buttons, and its next action (answer, close, unstick, give a reason, write the checklist, fix the header, ask the owner) ready to hand to the session.
- **`/board open`** writes the full page (the brief, a kanban by stage, the **Map** of intents on the game's modules, the weekly pulse, the timeline, every view with filters) and opens it in your browser.
- **`/board publish`** writes the same page and has the session publish it to the team's shared site, for leads and producers who do not run Claude Code.

## Install

```bash
claude plugin install ather-board@ather --scope user
```

Then type `/board` in a session opened in a checkout with intents (a `docs/intent` folder). Ather Automata is not needed alongside it.

## The views

| View | What it answers |
|---|---|
| **For you** (pane) | What needs you, by your git `user.name`: your intents waiting on your decision, ready for you to close, stuck, needing a checklist or a tidy header; then the rest of your open work. Above it, **Suggested**: Sonnet's brief (a headline and up to five suggestions, each naming real intents and one action) and the board's own (close your ready ones together, answer your oldest decision, the teammates' intents waiting on a decision). A suggestion is a press. |
| **Modules** (pane), **Map** (page) | The intents on the game's core modules: S2's main character locomotion, combat, nine-tail abilities and look; enemy locomotion, AI and abilities; bosses; quests; environment presets and levels; VFX, cinematics, audio, UI, performance and tooling. The pane groups intents by module; the page draws the network, modules as hubs and intents as dots (lime where someone is needed, bigger with more items open, dashed lines where one intent names another). |
| **Triage** | What needs someone, team-wide, grouped by reason, the worst first: decisions waiting on an owner or director, **Colliding** (below), ready to close (every item met, not closed), no change for 5 days or more, parked without a reason, no acceptance checklist. Each intent sits under its worst reason; its row names any others. Below it, **Data hygiene**: intents whose files the board could not fully read (a Status that is a sentence or another word than active, parked or completed; no Owner line; an area outside the list). |
| **Table** | Every intent, grouped by owner, area, stage or not at all, each group with a one-line rollup ("4 intents · 3 done · 6 open items · 2d"). Sort by recent, stalest, closest to done or most open items. Filter by words, area, owner and stage; done intents are hidden unless shown. |
| **Open items** | Every acceptance item not yet met, of every intent not done, grouped by area or owner, the biggest pile first. Parked intents' items count: they are still owed. |
| **People**, **Areas** | One line each: open, parked and done intents, open items, decisions waiting, stale intents, last change. Pick a name to see its intents in the table, or a count to see what it counts: its parked or done intents in the table, its open items, or Triage for its decisions and stale intents. |
| **Board** (page) | A kanban, a column for each stage that has intents: Plan, Building, Proving, Ready to close, Parked, Done. |
| **Pulse** (page) | Intents opened and closed per week, from the first week anything happened, and how many are in each stage. |
| **Timeline** (page) | The last 12 weeks, a lane per owner: each intent a bar from its folder's first commit to its last (to now while open), its stage's glyph and name on it; ink while it moves, outlined when ready to close or not begun, quiet once done, dashed while parked. Pick a bar for that intent in the table. Filters apply. |

Every row reads the same on both surfaces, as Ather's list does: stage glyph, name and its warnings (decisions waiting, stale, parked without a reason), the checklist bar (▰▱) and count, age, owner. Both use Ather's look: lime only for what needs someone, amber for a warning, ink and quiet grey for the rest; the page in light and dark.

Pressing an intent in the session opens it in place with what can be done about it, its next action first. On your own intents that is answering its decisions (each option a button, Ather's own decision prompt behind it), closing it, unsticking it, giving a parked one its reason, writing its checklist or fixing its header; on a teammate's, asking the owner (a drafted message, never sent) or where it stands. Each press hands the session one prompt; nothing changes until you agree there. On the page, clicking one opens its goal, open items, PRs and issue in place. The page keeps its view and filters in the address, so a link to "Table, VFX, stalest first" opens just that.

Stages are the ones Ather's list uses: **Building** while an item is open, **Proving** once every item is met and its PRs are not merged, **Ready to close** once every item is met with no PR named, **Plan** with no checklist, **Parked**, and **Done** for a Status of completed. The board does not ask GitHub about PRs.

## Sonnet's help, and what it costs

The brief, the ask box and the module map use Sonnet through the mod's own model calls. The brief runs once when the board opens and again only when `origin/main` moves, or on ↻. Each intent's modules are asked once and kept (in the mod's store, per repository) until the intent's title, area or goal changes, or the list of modules does; about 150 intents take three requests the first time and none after. Every reply is checked against what the board read: an intent or a module it does not know, or an action it does not have, is dropped.

The modules are S2's list for an Unreal checkout. A repository can name its own in `.ather/board.json`:

```json
{ "modules": [{ "key": "mc-locomotion", "name": "Main character locomotion", "hint": "movement, sprint, dodge, traversal" }] }
```

Without either, the modules are the intents' Areas, and no model is asked.

## Colliding: work that changes the same lines

An open intent with a `- Branch:` line is compared, on that branch, with the base branch and with the other open intents' branches. Two that would conflict when merged are a **collision**, one row in Triage after the decisions: `◐ dodge-cancel ⇄ main ▲ 3 overlaps`, the first file, when the base last changed those files, and the owners.

- **Pressed**, a row opens in place: what happened ("hitstop-retune changed these lines on origin/main 6m ago (Lena Park)": the intent whose pull request brought the change, when that pull request touched its intent folder), each place as `file:line` with each side's first changed line, a binary file (a map, an asset) as "binary, both changed", and what can be done. On your own intent against `main`: **Bring main into <intent>** (the session merges in a worktree, resolves each place, runs the gates, and shows you the diff before committing; nothing is pushed until you say), and a drafted note to whoever changed it. On two intents: a drafted note to the other owner, or to both owners asking who goes first, and where both stand. Nothing is sent: every note is a draft.
- **Everywhere else**, an intent in a collision warns "overlaps <what>" on its row, and **For you** lists your own collisions after your decisions.
- **How**: `git merge-tree --write-tree` merges each pair with no working tree or index (git 2.38 or later; with an older git, Colliding says so and stays empty). Two intents are merged only when their branches change a file in common. Each result is kept by the branch tips, so a pair nobody moved is never merged again. The check runs in the background after each read, in runs of at most 15 seconds of new git work: the board draws first, and the rows appear as they are found.
- **The branches**: with each fetch of the base (every ten minutes at most), the board asks origin where the open intents' branches are (`git ls-remote`) and fetches those that moved, the same way it fetches the base (no tags, no automatic gc). It writes only their remote-tracking refs. Intents without a Branch line, done and parked ones, and branches origin does not have are not compared.

## Where it reads, and how fresh

The board reads `origin/main` (or the branch the team merges into: `baseBranch` in `.ather/profile.json`, else the clone's default) through git, without taking git's lock, plus the checkout's own intent folders that are newer. When the pane is drawn it fetches that branch in the background at most every ten minutes (no tags, no automatic gc); `f` fetches now. The line under the title says how fresh the list is.

## The shared page

`/board publish` writes the page to `<checkout>/<local folder>/board/index.html` (in S2, `Saved/AtherAutomata/board/index.html`) and hands the session one prompt: publish that file through the **`vesper-sites`** MCP server, updating the earlier page in place. The page is one self-contained HTML file: no network, the data inside, light and dark, usable on a phone.

Add the studio's Sites MCP once, under that name, with the address the studio shares internally (it is not written here, as this repository is public):

```bash
claude mcp add --transport http vesper-sites <Sites MCP address>
```

Then sign in to it from `/mcp` in a Claude Code terminal. Without it, the session stops and says so.

## Changes

- **0.3.0** Counts that open: in People and Areas each count is a press (Enter in the pane, a click on the page) that opens what it counts. The page gains **Timeline**, a lane per owner over the last 12 weeks. A count of one open item now reads "1 item".
- **0.2.2** No change to what you see: a collision's words and actions come from Ather's `collide.mjs`, shared with Ather Automata's Needs you (ather-automata 0.5.0), and the check runs through its shared background job.
- **0.2.1** Colliding names the intent behind a change on `main` ("hitstop-retune changed these lines on origin/main 6m ago (Lena Park)"), read from the pull request's merge or squash commit that brought it. A large first check runs in short runs and shows collisions as they are found.
- **0.2.0** **Colliding**: open intents whose branches change the same lines as the base branch or as each other, found with `git merge-tree` (Ather Automata 0.4.1's overlap check), shown second in Triage, one row a pair, opened in place with the files, lines and each side's version, and what to do (bring the base in, or a drafted note). The intents warn "overlaps …" on their rows, For you lists yours, and the page shows the same. The board now fetches the open intents' branches with the base. An opened row no longer shows a thin gap above its details on the page.
- **0.1.1** A done intent shows how many of its items were met: the board now reads the progress of completed intents, which Ather's reader leaves out (they read as none met before). Done's glyph is ■, no longer close to Ready to close's ✓.
- **0.1.0** First release: `/board` opens on For you (what is yours to act on, with Sonnet's suggestions), then Triage, Modules, Table, Open items, People and Areas, with filters, sorts and groups; an ask box; intents opened in place with their decisions and next action, every action handed to the session; `/board open` (the full page with the brief, Board, Map and Pulse); `/board publish` (through the `vesper-sites` MCP server).

## Maintainers

The board reads intents with Ather Automata's own modules, copied into `hooks/ather/` by `node dev/sync-shared.mjs ather-board` (the entry modules are named in `shared.json`); never edit those copies. After a change to them in `ather-automata/hooks/`, run the sync; `node dev/test-all.mjs` fails while the copies differ, and runs the board's unit tests (`tests/*.test.mjs`). Then `claude plugin validate ather-board` and `claude plugin test ather-board`, bump `version` in `.claude-plugin/plugin.json` and the repository's `.claude-plugin/marketplace.json`, and add a line under Changes.
