# simple-view: Log

## 2026-10-18

- Baseline at origin/main eae8432: `node dev/test-all.mjs` exit 0 (unit 356/356, board 56/56, repos e2e 267/267; S2 e2e skipped, no S2_ROOT).
- home.mjs: `paneViewOf`, `isShownIn` and the one list of what Simple leaves out. state.mjs: `KEY.view`, `readPaneView`, `setPaneView` (967 lines). console.mjs: Home's parts named and drawn through `isShownIn`; `homeView` read once a session like Group; `pickView`; `v` toggle at Home's foot; `/ather simple`, `/ather advanced`.
- Tests: 3 unit (A1, A4), 9 repos e2e (A2-A6).
- Paseo and board copies synced; 0.4.0 in plugin.json, marketplace.json and the Paseo package; README Changes, commands and In 30 seconds; Paseo README Limits.

## 2026-10-18, thermo-nuclear round 1 (BLOCK)

- C1 (critical): the read-once, press-wins choice was copied from Group. Now one `remembered(initial, read, write)` in console.mjs serves Group and Home's view; `readGroup`, `readView` and six module variables deleted.
- Fixed non-critical: Simple lists what it shows (`SIMPLE_SHOWS`, typed `HomePart`), so a new part stays out of Simple until chosen; `otherView` and `VIEW_LABELS` in home.mjs; the A3 e2e checks every part this fixture draws; a new repos e2e checks Group is kept and read by a new session (it was only in the S2 e2e).
- Left: `paneViewOf` stays in home.mjs (the board's sync follows JSDoc `import()` types, so pointing home.mjs's type at state.mjs would copy state.mjs into the board); Home's render stays in `paneView` (extracting it is a separate change); hidden parts are still built (cheap).
- test-all exit 0: unit 360/360, board 56/56, repos e2e 277/277.
