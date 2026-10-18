# simple-view: Progress

Built 2026-10-18 on `ccr-c3eb09ca-i9bahh` (from origin/main eae8432, 0.3.5 → 0.4.0). PR #68.

Evidence run (after every edit): `node dev/test-all.mjs` exit 0: unit 360/360, board 56/56, repos e2e 277/277, Paseo and board copies in step. Not run here: the S2 e2e (no `S2_ROOT`), the Paseo type-check (no `npm install`), the mod type-check (no `CLAUDE_CODE_TYPES`). `claude plugin validate ather-automata` and `ather-board` passed; `claude plugin test ather-automata` 8/8.

## Acceptance

| Id | Verdict | Evidence |
| --- | --- | --- |
| A1 | met | Unit: `isShownIn` over every `HomePart`, `SIMPLE_SHOWS`, `paneViewOf`, `otherView`/`VIEW_LABELS`. |
| A2 | met | repos e2e: Simple draws the title and Next, none of stages, meta, strip, actions, Everything open, Heading off?, Stepping out?. |
| A3 | met | Every existing e2e passes; repos e2e: Advanced draws every part this fixture has, plus the toggle. |
| A4 | met | Unit (store per person); repos e2e: a second session on the same store opens in Simple. |
| A5 | met | repos e2e: `/ather advanced` and `/ather simple` switch and say how to go back. |
| A6 | met | repos e2e: keys unique in both views; desktop toggle has no key. |
| A7 | met, S2 e2e owed | The runs above; 0.4.0 in plugin.json, marketplace.json, Paseo package; README Changes. One S2 e2e run before merge (Group's original tests live there). |
| A8 | met | Thermo-nuclear review: round 1 BLOCK (C1, a copied read-once/press-wins protocol), fixed in a82f902; round 2 PASS, no critical findings. Left with reasons: `paneViewOf` stays in home.mjs (the board's sync follows JSDoc `import()` types); extracting Home's render from `paneView` is a separate change; hidden parts still built (cheap); the A1 test lists the part names by hand. |
