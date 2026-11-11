# Findings: the Paper Lab reference

## F1: what the video shows (2026-10-16)

A 22-second screen recording, 720×900 portrait at 30 fps, of one dashboard titled **CLAUDE CODE / PAPER LAB**, subtitled "research papers → reproducible experiments". It has a soundtrack, which was not analysed. The layout does not change and no one interacts with it: everything that moves moves on its own. Frames were read at one per second; the bottom panels were read enlarged. [`reference.jpg`](reference.jpg) is the frame at 12 s.

**Header.** The title sits on the left. Five counters are spread across the top: PAPERS 64, AGENTS 12, METHODS 11, REF. SCENES 28, FURTHER REVIEW 4. Under them is a bar of five segments, one lit; the lit segment steps from the first to the fifth over the 22 seconds, like a stage stepper.

**Hero (the top two-thirds).** A thick ring, seen edge-on and curving down the middle, is built from dense cards of tiny monospace text with numbers along its outer rim. It drifts slowly. To its left is a field of thin crossing curves with small circle nodes, like a citation or dependency web. Bundles of bright parallel threads strike the ring at points that move, so that one part of the ring is lit at a time. To its right, hundreds of horizontal rays fan out, their density varying like a spectrum. Small boxed callouts with a formula appear on the right and fade ("MASS CONSERVATION ∂ρ/∂t + ∇·(ρu) = 0", "STABILITY CHECK CFL = |u| Δt / Δx").

**Panels (the bottom third, a 4×2 grid).**

| Panel | What it holds | How it moves |
|---|---|---|
| INVESTIGATION FEED | Numbered rows `NNN  verb  action` (verbs: read, build, check, …; actions: "compare reference outputs", "record boundary conditions", "prepare clean checkout"). The newest row is bold. | Rows scroll up as numbers climb (002 → 156). |
| ADVECTION / PARTICLE SOLVER | A noise field of dots, with three tabs below: ADVECT, PROJECT, SCORE. | The dots shimmer, and the selected tab changes. |
| METHOD WORKSPACE | Numbered code lines (`papers = load_collection()`, `eqs = extract_equations(papers)`, `state = method.step(inputs)`, `check_mass(state, reference)`, …) with a block cursor. | A line types out, and the window rolls. |
| SHARED SCENE / DIFFERENCE FIELD | Two pixel grids, REFERENCE and IMPLEMENTATION, side by side, a rose patch where they differ, and a histogram underneath. "Same input / local difference". | The patch shifts. |
| SOURCE / EXTRACTION ROUTES | A table, PAPER · EXTRACT · CODE · CHECK, of rows (equation, settings, inputs, …), with one cell per row highlighted, and a small bar under it. "Pages → equations → runnable source". | The highlight moves along each row. |
| VALIDATION / SAMPLE BUFFER | Three waves: MASS, STABILITY, RESIDUAL. Labelled "illustrative / source check required". | The waves scroll. |
| 12 AGENTS / DISPATCH | Two columns of six agents (01 read, 02 build, 03 review, 04 qa, …). Each has a progress bar and a state (working, dispatch, waiting, waiting on …), some bars rose. "Independent jobs / shared event bus". | The bars fill and the states change. |
| METHOD / REFERENCE INDEX | A matrix: rows M01–M11 by reference-scene columns, with a status column (match, review). "10 scenes / 7 matched / 4 further review". | The highlighted row moves down. |

**The look.** The ground is near-black, with one-pixel grey hairlines and boxed panels. Text is monospace throughout, panel heads are small and uppercase in the form `NOUN / NOUN`, and figures are set plain. The palette is greyscale, except for a muted rose kept for differences and some dispatch bars. The screen is dense, with slow ambient motion everywhere and nothing flashing.

## F2: what is data and what is decoration

The header, feed, dispatch, routes and index are views of real state, and each one has an exact counterpart in Ather (see the table in `prompt.md`). The solver field, the waves (by the video's own label) and the formula callouts are illustration. The hero is mostly texture: its only readable meaning is "work is flowing into this part of the corpus now". Ather adapts the first group as it is, gives the hero that one meaning with real calls in flight, and leaves the rest out.

## F3: what the engine allows (Claude Code 2.1.301)

- **Terminal:** `Raster` (up to 512×256 cells, braille and blocks, 1024 colour pairs, `$.ui.blit` at up to about 60 frames a second), `Client` (its own frame clock, pointer and keys), and no `Svg`. The hero can be drawn in braille. Text panels are Box and Text.
- **Desktop:** `Svg` (at most 131,072 characters; `isInteractive` gives SMIL animation, `:hover` and tooltips with no script), `Client`, and no `Raster`.
- **Mobile:** `Svg`, with no Input and no `Client`.
- **Live events:** `agent.spawn` reports each worker, and `tool.call` carries `e.agentId` and settles through `next(e)`. Ather's watch half already records both, in `inflight.mjs` and `workers.mjs`.
- **A full HTML page** (canvas and script) is possible only outside the pane: the board's `/board open` page. That is the place for the closest copy of the hero (prompt D5).
