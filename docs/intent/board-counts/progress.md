# board-counts: Progress

Built and closed 2026-10-18 on `ccr-c3eb09ca-i9bahh` (from origin/main f4860d3). ather-board 0.2.2 → 0.3.0.

Evidence run: `CLAUDE_CODE_TYPES=<the engine's claude-code.d.ts> node dev/test-all.mjs` → exit 0: type-check and the Paseo type-check clean, unit 379/379, board 73/73, repos e2e 283/283, board e2e 17/17. `claude plugin validate ather-board` passed, `claude plugin test ather-board` 12 pass.

## Acceptance

| Id | Verdict | Evidence |
| --- | --- | --- |
| A1 | met | Unit "board-counts D1" (each count's view, area and stage; decisions land on VFX's intent); board e2e: People's counts are presses with no layout problem at 72 and 110 columns, and the items count opens Open items cut to that owner; `proof/pane-people-72.png`; `proof/page-people.png` → `proof/page-people-pressed.png` (Lena's 12 items: 5 + 5 + 2). |
| A2 | met | Unit "board-counts D2"; the page test runs `timeline` as written into the page and gets the same answer. |
| A3 | met | `proof/page-timeline.png`, `-dark.png`, `-phone.png` (18 intents from `proof/rich-page.mjs.txt`). |
| A4 | met | The evidence run; 0.3.0 with its Changes line. |
| A5 | met | Thermo-nuclear review round 1: BLOCK, C1: a count's behaviour was spread over four places (the kinds' order, `pickLook`'s two checks, `rollupLine`'s words, the page's own column list). Fixed in 57e7330 with one `COUNTS` table that all of them read, plus N1–N5 and N8 (a `Span` type with `isOpen`, the window's weeks returned, `DAY_MS` in the page, one pass by owner, `count` required). Round 2: PASS; its three nits taken (a comment on the unknown-count fallback, `isAlways` in the table, the default weeks). Left: N7, the page's view dispatcher stays a chain like its pulse and map branches. |
