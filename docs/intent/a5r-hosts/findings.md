# A5R hosts: Findings

Raised while building slice S-a (2026-11-09). None blocks S-a; each names what it changes and a proposal.

## F-a1: A1's "tools list output" is read as the pane's tools list

- What: A1 says the "tools list output" does not change with no hand-offs. The slice adds the model tool `mcp__a5r__host` (the brief and "Tools and commands" require it, and L0 `create` is its first action, so it cannot wait for a hand-off to exist). Read literally as "registered model tools", A1 and the brief conflict.
- Taken: "tools list" is the A5R pane's tools list (the tile row; README and the v2 tests use that name). The pane's blocks, the compact line and `status.json` are unchanged with no open hand-off (engine test `S-a (A1)`). The registered model tools are now editor, sync, host.
- Test change (no assertion removed): the three tests that list the registered tools now expect `['editor', 'sync', 'host']`: `a5r/tests/coord-engine.test.ts` (editor request), `a5r/tests/old-names.test.ts` (A48), `a5r/tests/rev40.test.ts` (A117).
- Proposal: say "the A5R pane's tools list" in A1 at the next rev.

## F-a2: the hand-off schema gains `by` (the session that recorded it)

- What: D9's own-claim exemption ("the hand-off's own session is not blocked by its own claim") needs to know that session; section 3 has no field for it.
- Taken: `by: { id8, lane }`, optional, written on create. Readers ignore unknown keys, so the schema stays `v: 1`.
- Proposal: add `by?` to section 3 at the next rev.

## F-a3: claim defaults are decided from the claim's own path

- What: F5 says binary assets default exclusive. A claim's `exclusive` is stored as a boolean (section 3), so the default is decided once, from the claim path: `Content/S2/A.uasset` or `Content/**/*.umap` default exclusive, a folder such as `Content/S2/Tail/` defaults shared even if it holds `.uasset` files.
- Effect: a folder of assets claimed without `!` lets another session edit its `.uasset` files (recorded, not refused).
- Proposal: keep it (explicit and predictable; `!Content/S2/Tail/` makes the folder exclusive), or decide per edited path when the claim gave no mark (needs a tri-state in the schema).
- Resolution (Hải, 2026-11-09): keep folder claims shared by default; `!` marks one exclusive.

## F-a4: no human command marks a hand-off merged

- What: the brief lists `/a5r handoff record|list|cancel|result`. Section 5 moves a hand-off to `merged` after the result is taken; in S-a only the tool's `update` with `state: "merged"` does it (refused until a result is recorded).
- Proposal: S-d adds result acceptance (A7), which moves it to `merged` after the result PR scores; a `/a5r handoff merged <id>` command can come with it.

## F-a5: what the claim check covers

- Edits through Edit, Write, MultiEdit and NotebookEdit in the shared checkout are checked (the same paths the touch files record). Shell commands that write a claimed path are not checked, and hand-written shell writes into `Saved/A5R/handoffs/` are not refused (the Edit/Write ones are). Acceptance applies claims to the S2 repository only, like other sessions' touch files.
- Proposal: extend to shell writes with the existing `writesInside` reader in a later slice if a lane needs it.

## F-a6: gate results that fail on the base too

- `node dev/test-all.mjs` stops at its unit stage on `FAIL reading a checkout (A1) > origin/main’s intents with their first and last commit dates…` (ather-board). The same test fails on the untouched base commit 586691c, run in a temporary worktree.
- The repos stage (`--only repos`) fails 54 tests on this branch and 54 on the base; the names differ by one pair of worktree-listing tests that alternate between runs (flaky). This branch changes nothing under `ather-automata/`, `ather-board/`, `ather-lanes/`, `paseo/` or `dev/`.
