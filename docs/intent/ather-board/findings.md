# Findings

## F-1 (2026-10-13, rev 1) | blocking: no | status: resolved (worker)

A second UX/UI pass on the board, asked by Tin: Gestalt, "less, but better", and Ather's own look. Audited on the page from S2's records of 2026-10-13 (146 intents: 49 need someone, 11 in data hygiene) at 1440 and 375 px, light and dark, and on the pane drawn as terminal text at 100 and 72 columns.

### Audit

**Ather's look, as Ather Automata draws it** (rows.mjs, worklist.mjs, the Paseo panel, team-truth D7): near-black; one lime accent kept for what needs the person; light ink for headings and progress; quiet grey for everything secondary; amber for a warning on its row. Letter-spaced capitals for top-level sections only, sub-groups bold with a count, never lime. One row anatomy: stage glyph, title, warning, then the bar (five cells, ▰▱, in ink), count, age and owner in aligned columns.

**The page does not look like Ather.**
- Six colours carry meaning: a generic blue accent (tabs, the loud heading, links, Building, opened bars), amber, red and green pills, green progress bars, a purple Parked. Lime appears nowhere. Colour stops meaning anything.
- The row is not Ather's anatomy: bold slug, title, then a right-aligned column of pills, owner, a smooth green bar, count, age. The pane draws glyph, title, warning, bar, count, age, owner. Two surfaces, two orders.
- Flags are pills, one per flag, in four colours; "every item met, not closed" sits on every ✓ row although the glyph says it, and "no change for 7 days" sits beside an age column that says 7d.

**Gestalt.**
- Common region is spent on the wrong unit: every one of 140 rows is its own bordered card, so the group (an owner, an area) has no region and the page reads as a wall of boxes.
- Similarity: the kanban's Ready to close column repeats its own title as a green pill on every card; Plan is empty yet takes a full column; with done hidden, Done is empty too. Six fixed 220 px columns overflow any pane under 1400 px.
- Hierarchy: in the pane, every Table and Open items group (an owner, an area) is a letter-spaced label, as loud as Needs someone (D7 keeps that for top-level sections). In Triage, 49 rows sit under one heading although they are already sorted by reason (16 decisions waiting, 7 ready to close, 17 stale, 9 parked without a reason): the order is there, its structure is not drawn.
- Proximity: at 1440 px the People table spreads eight columns across the window, numbers far from their names; zeros are as loud as the counts that matter. The pane's view tabs and its two actions (Open the page, Publish) share one row and one look.
- Continuity: Pulse keeps four weeks at least, so the chart opens on an empty week; week labels are "09-28" in an SVG scaled down with the page (about 7 px on a phone).

**Less, but better.** Remove what repeats (the pills a glyph, a column or an age already says), what is empty (a stage with nothing in it), what is decoration (the stage colours, per-row borders), and draw progress the one way Ather does.

### Proposed changes

1. **One palette, Ather's**, in page/board.css: near-black with Ather's ink and quiet in dark; a paper counterpart in light that keeps the discipline (ink #1b1c1a, quiet at 5:1 contrast, amber darkened to #9a5a00 for text). Lime only on Needs someone: as text in dark, as a fill behind ink in light (lime text on white is unreadable). Amber for warnings. Everything else ink or quiet: tabs, links, focus, glyphs, bars, charts.
2. **One row anatomy on both surfaces**: glyph, slug and its warnings (amber text, not pills), the title beneath it (quiet), then bar, count, age and owner in fixed columns, in Ather's order. The bar is Ather's own `miniBarSvg`, five cells in ink, written into the page from worklist.mjs as `ageText` is. At phone width the owner, age and bar move to a second line instead of vanishing.
3. **Common region at the group**: a group (owner, area, stage, reason) is one panel, its rows divided by hairlines; its head sits on it. Done rows are quiet.
4. **Two levels of heading, typed**: views.mjs gains a `label` section (top-level, letter-spaced; `isLoud` moves there) beside `intents` sections, which are groups (bold title and a quiet rollup). The pane draws labels with Ather's `label()` and groups bold, with no blank line between a label and its first group; the page the same.
5. **Triage grouped by reason**: Needs someone holds one group per reason, worst first (Decisions waiting, Ready to close, No change for 5 days or more, Parked without a reason, No acceptance checklist), each with its count; a row leaves out the warning its group's head already says (a decision count stays: it is the row's own). Data hygiene stays one group.
6. **Shorter, non-repeating warnings**: a row warns with decisions, stale and parked-without-a-reason only (ready to close and no checklist are what its glyph says); "no change for 7 days" becomes "stale" (the age column has the days; People and Areas already say "stale"); "parked, no reason given" becomes Ather's "parked, no reason".
7. **The kanban**: only stages with intents get a column; columns fit the width and wrap rather than overflow; cards carry slug, owner and area, bar, count, age and warnings, without the glyph their column says.
8. **Pulse**: starts at the first week anything happened; drawn in HTML so its labels stay 12 px at any width; weeks read "Sep 28"; opened in quiet, closed in ink; stage bars in ink (Done quiet).
9. **People and Areas**: one panel at most 880 px wide; zeros quiet so the counts that matter stand out; names in ink, not link blue.
10. **Page frame**: content capped at 1240 px with one left edge for header, tabs, controls and views; the brand line "ATHER BOARD" above the title, as Ather's panel has it. In the pane, the actions are set apart from the view tabs and dim.

Not proposed: the Ather mark (it is private to rows.mjs; a copy would be a duplicate), sticky headers, a count on the Triage tab, per-stage colours in any form.

Resolution (worker, 2026-10-13): built as proposed in S2 (progress.md), all ten changes; gates green; thermo-nuclear review round 1 BLOCK (a label's groups placed by order), fixed, round 2 PASS. Status: resolved, for the owner to see on the page.
