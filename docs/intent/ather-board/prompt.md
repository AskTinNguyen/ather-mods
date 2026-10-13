# Ather Board: the team's intents as a project board

- Rev: 3
- Status: active
- Area: ather-board
- Owner: Tin Nguyen
- Skill: `plugin-authoring`
- Branch: `intent/ather-board`
- Started: 2026-10-13

## Goal

S2's team now records its work as intents (142 folders on origin/main on 2026-10-13: 69 active, 54 completed, 9 parked, the rest with a sentence for a status). Ather's "Teammates' intents" list shows them as one long flat list grouped by person. It is hard to scan: each owner's name appears twice, finished and open work are mixed, every row carries the same repository tag, there is no way to cut the list by area, stage or what is stuck, and collapsed groups say nothing. Build a separate, read-only mod that makes sense of all of them: what is stuck, where everything stands, the open acceptance items, sorting and filtering, and a page the team can share.

## Non-Goals

- The mod writing to the repository itself. Since rev 2 the board offers actions, but every one is a prompt handed to the session, which does the work with its own tools and asks before it writes, commits or messages anyone (D6).
- Changing Ather's own pane in this change (a follow-up shrinks its teammates' list to a link to the board).
- A Paseo version (a follow-up, once the Claude Code one has been used).
- Changing how S2 writes intents. The board reads the fields as they are and lists what it cannot read as data hygiene.
- Reading PR states from GitHub (one `gh` call per PR across 140 intents); stages use what the files say, as Ather's list does.

## Decisions

- D1 (Tin, 2026-10-13): one data layer, two surfaces. `/board` opens a compact pane in the session (terminal and desktop side panel); `/board open` writes a full-width HTML dashboard and opens it.
- D2 (Tin, 2026-10-13): read-only.
- D3 (Tin, 2026-10-13): both audiences. People in Claude Code use the pane; leads and producers get a shared page, published through the studio's Vesper Sites MCP (its address is internal and stays out of this public repository).
- D4: the board reads intents with Ather's own reader (`team.mjs` `readTeam`, origin/<base> through git, never the index lock) and Ather's parsing (`model.mjs` `parseIntent`, `worklist.mjs` `listStage`, `ownerName`). Those modules are copied into `ather-board/hooks/ather/` by `ather-board/sync.mjs`, as `paseo/ather-automata` does, and `dev/test-all.mjs` fails while the copies differ. One canonical home, no hand-made duplicates.
- D5: the publish step is handed to the session as a prompt naming the generated file, because the Sites MCP's tools need the person's sign-in and are not known to the mod ahead of time.

- D6 (Tin, 2026-10-13, rev 2): actions from the board go through the session, which asks first. The mod stays read-only; a press hands the session one prompt (Ather's own decision prompts for answering a finding).
- D7 (Tin, 2026-10-13, rev 2): the AI brief runs when the board opens, cached per origin/<base> commit, again only when that moves or on a press.
- D8 (Tin, 2026-10-13, rev 2): "For you, then team": the pane opens on what is actionable for the person at the keyboard (by git identity); the team views stay one tab away.
- D9 (Tin, 2026-10-13, rev 2): the brief and the ask box use Sonnet, through the mod's own model calls ($.model.complete).

## Acceptance

- A1: One record per intent, from the shared reader: title, area, owner (tidied), stage (Plan, Building, Proving, Ready to close, Parked, Done), checklist done/total, open items, PRs, issue, open decisions, last change, first commit. Unit tests on fixture intents.
- A2: Health flags: stale (open with no commit for 5 days or more), ready to close, parked without a reason, decisions waiting, no checklist, and data hygiene (a status that is not one word, no Owner, an area outside the pack's list). Triage lists the flagged intents, worst first. Unit tests.
- A3: Filter (search words, area, owner, stage, done shown or not), sort (recent, stalest, closest to done, most open items) and group (owner, area, stage, none), each group with a one-line rollup (count, done, open items, last change). Unit tests.
- A4: Outstanding items: every unmet acceptance item of every open intent, grouped by area or owner. Unit tests.
- A5: Pulse: intents opened and closed per week, and counts by stage. Unit tests.
- A6: `/board` opens a pane with Triage, Table, Items and People/Areas views, the filters above; pressing an intent asks the session about it, read-only (Ather's `aboutIntentPrompt`). `claude plugin test ather-board` covers the command and the pane.
- A7: `/board open` writes one self-contained HTML file (no network, data inside) with Triage, Board (kanban by stage), Table, Items, People, Areas and Pulse views and the same filters, light and dark, usable at phone width; and opens it. A test renders it from fixtures; a run against D:\s2 is recorded.
- A8: `/board publish` writes the same page and hands the session one prompt to publish it through the Sites MCP. The README says how to add that MCP.
- A9: Gates: `node dev/test-all.mjs` (with the board's tests and sync check), `claude plugin validate ather-board`, `claude plugin test ather-board`; marketplace entry and README; thermo-nuclear review with no critical finding open.

- A10 (rev 2): **For you**: the pane's first view lists, for the person at the keyboard, their intents waiting on their decision, ready to close, stale, and needing a reason, a checklist or a tidy header, then the rest of their open work; plus suggestions that need no model (close the ready ones together, answer the oldest decision). Unit tests on fixtures.
- A11 (rev 2): **Next action and actions in place**: every intent has one next action worked out from its flags and whose it is (the owner's: answer, close, unstick, give a reason, write the checklist, fix the header; a teammate's: ask the owner, where it stands). Pressing a row opens it in the pane with its goal, its decisions with their options as buttons (the owner's own), and its actions; each press hands the session one prompt that changes nothing without asking. Batch: close every ready one of yours at once. Unit and engine tests.
- A12 (rev 2): **AI brief**: Sonnet reads a digest of the open intents and returns a headline and three to five suggestions, each naming its intents and one action; the board checks every name and action against what it read and drops the rest; it runs on open, once per origin/<base> commit, and on ↻. Engine test with the model answered by the test; unit tests of the request and of parsing a good, a partial and a broken reply.
- A13 (rev 2): **Ask**: a question typed in the pane goes to Sonnet with the same digest and comes back as a short answer plus a cut of the board (a view, filters, or the intents named), applied at once and cleared with one press. Engine and unit tests.
- A14 (rev 2): The shared page shows the latest brief (read-only) at the top of Triage, its intents as links into the table.
- A15 (rev 3): **Map of modules**: intents mapped onto the game's core modules (S2's default list: main character locomotion, combat, nine-tail abilities and look; enemy locomotion, AI and abilities; bosses; quests and encounters; environment presets and levels; VFX, cinematics, audio, UI, performance, tooling; a repository's own list in `.ather/board.json`; else its Areas, with no model). Sonnet sorts each intent into one to three modules; each answer is kept across sessions with the intent's fingerprint (title, area, goal) and asked again only when that or the list changes. Intents relate when one's files name another. The pane's Modules view groups intents by module; the page's Map draws the network (modules as hubs, intents as dots, lime where someone is needed, dashed where one names another). Unit tests (list, sorting and its checks, keeping, mentions, sections, graph, a stable layout) and engine tests (by area without a model; a repository's own list sorted once and kept).

## Changelog

- Rev 1 (2026-10-13): from Tin's request and answers (L-1, L-2).
- Rev 3 (2026-10-13): a map of intents onto the game's core modules (L-5; A15).
- Rev 2 (2026-10-13): proactive board: For you, next actions and actions in place through the session, an AI brief and an ask box (L-3, L-4; D6-D9; A10-A14).
