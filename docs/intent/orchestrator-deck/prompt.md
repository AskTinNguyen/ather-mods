# Ather Deck: the orchestrator view, after the Paper Lab reference

- Rev: 0 (proposal)
- Status: proposed
- Area: ather-automata
- Owner: Tin Nguyen
- Skill: `plugin-authoring`
- Branch: `intent/orchestrator-deck`
- Started: 2026-10-16

## Goal

Tin shared a 22-second reference video, "Ather Mods Orchestrator References" (a dashboard titled *Claude Code / Paper Lab*; one frame is in [`reference.jpg`](reference.jpg), and [`findings.md`](findings.md) describes it panel by panel). Learn its UX and adapt it as a view in Ather: one dense, quiet, monochrome screen that shows a whole multi-agent session at a glance. It should show what each worker is doing, what has been proved, what is still open and what needs you, with motion only where something is actually running.

Ather already holds almost every fact the reference draws: the worker squad and its tree (`crew.mjs`, `squad.mjs`), the calls in flight (`inflight.mjs`), Plan → Build → Prove → Ship per intent (`worklist.mjs`), acceptance items (`model.mjs`), proof from tool output (`watch.mjs`), and Needs you (`home.mjs`). Today the pane shows them as rows. The deck shows them as panels.

## Non-Goals

- Anything decorative that looks like data. The reference's solver field, sample waves and equation callouts are illustrative; the video labels its own waves "illustrative / source check required". Ather draws facts only (crew-tree-and-groups D4). Each mark on the deck is bound to a signal Ather records, or it is left out.
- Replacing `/ather`'s pane. The deck is a second view of the same data, opened by command.
- Writing anything. The deck is read-only; presses hand the session a prompt, as the board's do (ather-board D6).
- A Paseo version, until the Claude Code one has been used.
- Sound.

## Sources

- The reference video (720×900, 30 fps, 22 s, with a soundtrack that was not analysed), kept by Tin. Its frames were read at one per second, with the panels enlarged; see `findings.md`.
- The engine's API for this build (Claude Code 2.1.301, `claude-code.d.ts`):
  - The **terminal** has `Raster`, a cell grid of up to 512×256 cells. Each cell is a glyph (blocks, box drawing and braille included) with a foreground and background colour, from 1024 colour pairs at once. `$.ui.blit` repaints it in place, up to about 60 frames a second, with no redraw. The terminal has no `Svg`.
  - **Desktop** and **mobile** have `Svg`, at most 131,072 characters. With `isInteractive`, it draws in a script-less sandboxed frame, so SMIL animation, `:hover` and `<title>` tooltips work. Desktop has no `Raster`.
  - The terminal and desktop also have `Client`, a module drawn on the surface's own thread. It gets a frame clock (`surface.every`), pointer and key events, and `post` back to the hooks.
  - Workers are reported by `agent.spawn`, and their calls by `tool.call` with `e.agentId`. Ather already hooks both.
- Ather Board's Map (ather-board A15) already lays intents out on a ring of module hubs, in the board's HTML page.

## What the reference does, and what it becomes

| Paper Lab | Ather Deck | From |
|---|---|---|
| Header: title, then five counters (Papers 64, Agents 12, Methods 11, Ref scenes 28, Further review 4) | The workspace and the tracked intent, then Intents open, Workers live, Calls in flight, Proof passed, Needs you | `worklist`, `crew`, `inflight`, `watch`, `home` |
| A segmented bar under the header, one segment lit, stepping across | Plan → Build → Prove → Ship for the tracked intent, its stage lit | `listStage` |
| Investigation feed: numbered `verb  action` rows, the newest bold | Feed: each tool call, numbered, `read`/`edit`/`build`/`test`/`review` plus its own description, the worker's tag, the newest bold | `inflight`, `propForTool` |
| 12 agents / dispatch: two columns, role, bar, state (working, dispatch, waiting); "independent jobs / shared event bus" | Dispatch: the squad, kind, elapsed bar, state (running, waiting on …, asking, done, failed), indented under its parent | `crewRows` |
| Method workspace: code lines appearing with a cursor | Workspace: the focused worker's brief and the lines of its latest edit, shown as its calls land. No simulated typing. | `agent.spawn` brief, Edit inputs |
| Source / extraction routes: per-paper row across extract → code → check, the current cell lit | Routes: one row per open intent across Plan, Build, Prove, Ship | `worklist` |
| Method / reference index: a matrix of rows by scenes, match or review, a count line | Index: intents by acceptance items, met or open, "N items / M met / K open" | `parseIntent` |
| Shared scene / difference field: reference and implementation side by side, a histogram | Proof: the gates the profile requires next to the passes seen this session, and gate runs over time | profile gates, `watch` evidence |
| Validation / sample buffer: three waves | Pulse: calls per minute, failures, time spent waiting. Real series only, labelled with their window. | a new ring buffer beside `inflight` |
| Advection / particle solver | Left out: nothing in Ather is like it | |
| The hero: a ring of dense text cards; to its left a field of curves and nodes; bright thread bundles striking the ring; rays to the right; formula callouts that fade | A ring of workers (or intents) as cards. To the left, the modules and files they touch (the board's Map). A bright bundle for each call in flight, from its worker to what it reads or edits. Rays for what lands: commits, passes, PRs. A callout for the latest decision or finding, fading. | `crew`, `inflight`, board modules |

The look to keep: near-black ground, 1 px grey hairlines, monospace everywhere, small uppercase panel heads in the form `SECTION / SUBTITLE`, figures set large and plain, and one muted rose accent kept for what needs attention (the reference uses it only in its difference field and a few dispatch bars). Motion is ambient and slow, and it stops when nothing runs.

## Proposed decisions (for Tin)

- D1 (proposed): **Where it lives: ather-automata, in new files.** The live facts (workers, calls in flight, proof seen) are held in automata's session memory, so another mod could not read them, and copying readers as ather-board does only covers what is on disk. A pure model `deck.mjs` (snapshot to panels, no `$`), a terminal drawer `deck-raster.mjs` and a desktop drawer `deck-svg.mjs`. `console.mjs` is already 2,194 lines, so it only routes the command. Alternative: a separate `ather-deck` mod reading an exported `$.state` contract of automata's. That adds a contract to keep in step, for no gain the team has asked for.
- D2 (proposed): **Opened by `/ather deck`**, and by a press on the pane's crew head when two or more workers run.
- D3 (proposed): **One model, three drawings.** Terminal: Box and Text panels with a `Raster` hero in braille. Desktop: the same panels with an interactive `Svg` hero (SMIL for the pulses, `<title>` for each card). Mobile: the panels and a still `Svg`. Every surface draws from the same `deck.mjs` output, and tests compare them.
- D4 (proposed): **Frame budget.** The hero repaints only while the pane is placed (`isPlaced`) and something runs: at most 10 frames a second, 1 a second when idle, none when hidden. Panels redraw when their data changes, not on a clock.
- D5 (proposed): **Team view later, in the board.** The same look as a "Lab" theme of the board's HTML page (`/board open`), where full canvas and script are allowed. Its ring is the board's Map. This is a separate intent, after this one is in use.

## Acceptance (proposed)

- A1: `deck.mjs` turns one snapshot (crew, calls in flight, worklist, acceptance, proof, Needs you) into the header, stepper and the seven panels above: plain data, every value traced to its source. Unit tests on fixture snapshots, including an empty session and 12 workers.
- A2: Feed, Dispatch, Routes and Index match what `/ather`'s pane says of the same snapshot: the same states, the same counts, and the same waiting lines (crew-tree D4). Unit tests.
- A3: Terminal: `/ather deck` opens a pane with the panels and a braille `Raster` hero sized to the pane. The hero is redrawn by `blit` within D4's budget. `claude plugin test ather-automata` mounts it at 80, 120 and 200 columns.
- A4: Desktop and mobile: the same panels with an `Svg` hero under 131,072 characters, interactive on desktop. Engine tests on both surfaces.
- A5: Nothing simulated. A test feeds a snapshot with no workers, calls or proof, and checks that the hero, feed and pulse draw empty states, not motion.
- A6: Pressing a worker, an intent or a matrix cell hands the session one read-only prompt: Ather's own `aboutIntentPrompt` for an intent or a cell, and a new, like-shaped prompt for a worker.
- A7: Gates: `node dev/test-all.mjs`, `claude plugin validate ather-automata`, `claude plugin test ather-automata`; README and release note; a thermo-nuclear review with no critical finding open (AGENTS.md).

## Open questions

- Q1: Should the hero's ring hold the session's workers (live, this session) or the team's intents (the board's ring)? This proposal says workers, with intents in the board's Lab theme (D5).
- Q2: Should the deck replace the pane's crew block when many workers run, or stay a separate command?
- Q3: Is the rose accent for "needs you" only, or also for failures?

## Changelog

- Rev 0 (2026-10-16): proposal from the reference video, for Tin's go.
