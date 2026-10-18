# overlap-hardening: Log

## 2026-10-18

- Created after the Fable review of the next-intents proposal; built the same day.
- overlap.mjs: `budgetMs` and `isPartial` (D1); `broughtBy` and `intentsIn` name the intent behind a base change (D2). The first version combined `--first-parent` with `--ancestry-path`, which skips a pull request's merge; its unit test passed only through the squash fallback. The board e2e caught it once Lena's retune landed by a merge; rewritten to walk the base's own line and the commit's descendants.
- Board: runs again at once after a partial run, drawing between runs; the fact names the intent.
- `dev/bench/overlap.mjs` (D3); `dev/e2e/harness.mjs` for repos.mjs and board.mjs (D4).
