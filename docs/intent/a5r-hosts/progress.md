# A5R hosts: Progress

- Working under rev: 2
- Current step: slice S-a (L0) built, on `intent/a5r-hosts`, not pushed, no release yet
- Next step: S-b (`host add`, C1/C2/C4/C5/C10, ssh and manual adapters, options and state.json, Hosts tile). Findings F-a1 to F-a6 in findings.md (F-a3 resolved by Hải: folder claims stay shared).

## Checklist (slices from prompt.md)

- [x] Slice S-a (L0): hand-off record, claims at the hook and at acceptance, pane rows and status.json `handoffs`
- [ ] Slice S-b (L1 add) / S-c (cards, suggest) / S-d (L2) / S-e (runner)
- [ ] A16 host Editor rules, A17 options vs state

## S-a: what was built

- `a5r/hooks/claims.ts`: claims (`covers`, `claimOf`, exclusive defaults `*.uasset`, `*.umap` plus the option `claimExclusiveGlobs`), `claimedBy` (open hand-offs only, exclusive first, own-session exemption), `exclusiveHits` for acceptance.
- `a5r/hooks/handoff.ts`: the hand-off file (section 3 plus `by`, F-a2), `parseHandoff`, `writeProblem` (one origin, origin-side states, merged needs a result, D13 secret scan), `checkBase` (D7: `git ls-remote`, then `merge-base --is-ancestor`), `/a5r handoff` parsing, `statusRows`.
- `a5r/hooks/handoffhost.ts`: the host side on closures: tool `mcp__a5r__host` (action `handoff`: create, update, cancel, result, list; other actions answer `A5R · host — not in this version → slice S-b adds hosts`), `/a5r handoff record|list|cancel|result`, the edit check (exclusive claim refused, shared recorded as `claim-touch` after the call ran, hand-off files refused to hand edits), the pane's HAND-OFFS row group.
- Wiring: `a5r/hooks/register.ts` (shrinks 4148 -> 4136 lines: the recorded-action file helpers moved to `a5r/hooks/acts.ts`; one table `A5R_TOOL_ERRORS` in `a5r/hooks/tooldefs.ts`), rule 1 in `a5r/hooks/accept.ts`, `handoffs` in `a5r/hooks/syncplan.ts` / `a5r/hooks/freezehost.ts`, option in `a5r/.claude-plugin/plugin.json`, README section "Hand-off".
- Tests: `a5r/tests/hosts-sa.test.ts` (8 unit), `a5r/tests/hosts-sa-engine.test.ts` (8 engine). Three existing tests that list the registered tools now expect `['editor', 'sync', 'host']` (`a5r/tests/coord-engine.test.ts`, `a5r/tests/old-names.test.ts`, `a5r/tests/rev40.test.ts`; F-a1); no assertion removed.

## Gates (2026-11-09, worktree, uncommitted tree then committed as is)

- `npx -y -p typescript@5.6 tsc -p a5r`: exit 0, no output.
- `claude plugin test a5r`: `837 pass` / `0 fail` / `Ran 837 tests across 76 files. [105.54s]` (final run, after review 2's fix). Earlier runs each had one different 5 s-cap timeout (`RAM: the launch gate comes from the plugin options`, `A51 (desktop, slow): the pane entrance…`), each passing in the other runs (load flakes, not hand-off code).
- `claude plugin validate --strict a5r`: `✔ Validation passed` (one existing warning: no marketplace install line in the README).
- `node --experimental-strip-types a5r/tests/scan-old-names.mjs`: `0 decision-convention strings outside the exceptions, 5 of 5 exceptions in use`; `0 missing`; `0 outside a labelled example`.
- `node --experimental-strip-types a5r/tests/build-script-smoke.mjs`: `… all as expected`.
- `node --experimental-strip-types a5r/tests/merge-script-smoke.mjs`: `… all as expected`.
- `node dev/check-size.mjs`: `size check: passed (138 code files changed).`
- `node dev/test-all.mjs`: FAILED at the unit stage on `FAIL reading a checkout (A1)` (ather-board), which fails the same on the base 586691c (F-a6). `--only repos`: 294/350 here, 294/350 on the base (same count; one flaky pair alternates). `--only board`: `18/18 passed`. `--only lanes`, `--only s2`, paseo and type-check stages: skipped (no LANES_SCRIPTS, S2_ROOT, npm ci, engine types).

## Acceptance

| Item | Verdict | Evidence |
| --- | --- | --- |
| A1 | met (S-a) | engine test `S-a (A1)`: no hand-off, or only cancelled/merged ones: the A5R pane's blocks and status.json keys unchanged, no `hai-handoffs`, no `handoffs` key; an open one adds both, `v` 1. `/a5r handoff record` works with no adapter (`S-a: /a5r handoff record writes one file…`). Full suite 837 pass 0 fail. "tools list" read as the pane's tools list (F-a1) |
| A2 | open | S-b |
| A3 | open | S-b, S-d |
| A4 | open | S-b, S-d |
| A5 | open | S-c |
| A6 | open | S-c |
| A7 | open | S-d (S-a has the writer guard, D7 and D13 parts: unit tests `writer guard`, `D7`) |
| A8 | open | S-d |
| A9 | met (S-a parts: record, claim, acceptance) | unit `claimedBy …`, `claims: globs …`, `S-a (A9): unit: rule 1 …`; engine `S-a (D9): an edit inside another hand-off's exclusive claim is refused; inside a shared one it runs and is recorded …` and `S-a (A9): a PR whose diff holds a path … refused under rule 1; a reason line in findings.md lets it pass`: all pass in the 837-pass run |
| A10 | open | S-d |
| A11 | open | S-d, S-e (scenario 1 and 7's L0 record covered by the A1 test) |
| A12 | open | S-b, S-c |
| A13 | open | S-b |
| A14 | met (S-a) | new code in `claims.ts` (≈95 lines), `handoff.ts` (≈230), `handoffhost.ts` (≈180); register.ts 4148 -> 4136; `node dev/check-size.mjs`: `size check: passed`; `$` only in register.ts; `claude plugin validate --strict a5r`: `✔ Validation passed`; `node dev/test-all.mjs` fails only where the base fails (F-a6) |
| A15 | open | review below; release with the slice's PR |
| A16 | open | S-c, S-d |
| A17 | open | S-b |

## Thermo-nuclear review

- Review 1 (S-a diff, subagent): Verdict: block. Critical: C1 claim-touch recorded before every refusal ran; C2 base ref normalized twice with a RegExp built from user input; C3 the three-tool test repeated and a growing ternary in register.ts; C4 duplicate status-row type, optional hook, hand-written ClaimTouch. Minors: result kinds twice, claim text twice, io shapes in acts.ts, `needs` cast, unknown op answered as S-d, nine advertised actions, status() double pass, origin id length, comment placement.
- Fixed in the S-a commit: C1 (record after the call ran), C2 (`baseRefOf` once in `fieldsOf`), C3 (`A5R_TOOL_ERRORS` table), C4 (`StatusHandoff`, required hook, `Omit<Recorded,…>`), and every minor.
- Review 2 (same reviewer, after the fixes): Verdict: pass. Three minors; fixed: `A5R_TOOL_ERRORS` is a Map (no inherited keys), `toolErrorText` indexes it without the dead fallback. Kept: literal tool names as the Map's keys (the constants live in register.ts and handoffhost.ts; tooldefs.ts holds the names as text, as EDITOR_TOOL_DEF does).

Verdict: pass
