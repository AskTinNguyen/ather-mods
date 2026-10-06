# web-pack: Progress

- Working under rev: 1
- Worker: `web-pack-worker`
- Current step: S3: unit tests for pack selection (A2) and web detectors over han-viet fixtures (A3)
- Next step: held actions and traps tests (A4, A5)
- PR: none yet

## Acceptance

<!-- One row per acceptance id in prompt.md, same order. Verdict is exactly met or open; met needs evidence (commit / command and its result line). -->

| Item | Verdict | Evidence |
| --- | --- | --- |
| A1 | met | S2: `node --test ather-automata/tests/*.test.mjs` → `ℹ pass 75 ℹ fail 0`; `S2_ROOT=E:/S2_ node dev/test-all.mjs --layouts` → `75/75 passed`, `185/185 passed`; `diff` of layouts-72 (399 lines) and layouts-110 (83 lines) against a base worktree at `02b9f38` run on the same S2 state: identical |
| A2 | open | |
| A3 | open | |
| A4 | open | |
| A5 | open | |
| A6 | open | |
| A7 | open | |

## Steps

<!-- S<n> (rev <r>, <YYYY-MM-DD>): <what was done>. Evidence: <commit / command and result line / PR>. Acceptance: <A-ids moved>. -->

- S1 (rev 1, 2026-10-06): baseline before any refactor. Added `--layouts <dir>` to `dev/test-all.mjs` (passed to `dev/e2e/run.mjs`; every `check()` layout at 72 and 110 columns written to `layouts-72.txt` / `layouts-110.txt`), and a `node:test` adapter so the plain `node --test` gate resolves `claude-code/testing` (F-1). On base `2f25364`: `S2_ROOT=E:/S2_ node dev/test-all.mjs --layouts base1` → `75/75 passed`, `185/185 passed`; a second run `base2` → identical layouts (`diff` empty, 399 + 83 lines), so the dump is deterministic against a fixed S2 state. `node --test ather-automata/tests/*.test.mjs` → `ℹ pass 75 ℹ fail 0`. Evidence: this commit. Acceptance: A1 (baseline only).

- S2 (rev 1, 2026-10-06): the Unreal specifics moved behind a pack interface. `hooks/packs/unreal.mjs` holds roles and their labels, areas, the five rungs with their detectors (`readShell`, `mcpKind`), required rungs per role, prove/brief/ship/tour/ask prompts, traps, the Editor owner lock (`lockFile`, `parseLock`, `lockRoles`, `ownCheck`), the Skills and Create catalogs, held Editor actions and the mandate words; `hooks/shell.mjs` the shared command-line reading; `hooks/packs/index.mjs` the `Pack` typedef and selection; `core.mjs` and `web.mjs` the other two packs. `model`, `guards`, `home`, `away`, `issues`, `state`, `watch` and `console` take the lane's pack (default `unreal`, so every existing export and test is unchanged). The e2e sandbox gets an `S2.uproject` marker, as a real S2 checkout has. Evidence: this commit; `node --test ather-automata/tests/*.test.mjs` → `ℹ pass 75 ℹ fail 0`; `S2_ROOT=E:/S2_ node dev/test-all.mjs --layouts L-new2` → `75/75 passed`, `185/185 passed`; base worktree at `02b9f38` run on the same S2 state → layouts-72 and layouts-110 identical (`diff -q` silent). Type-check with the engine types reports the same 3 errors as the base (AskUserQuestion missing from this build's tool list), none new. Acceptance: A1.

## Decisions (worker)

- W1: layouts are compared per `check()` call in run order; any difference in order, text or count is a regression.
- W2: packs live in `ather-automata/hooks/packs/` (one hooks module per plugin, so the engine loads them as relative imports). A pack is a plain object (`Pack` in `packs/index.mjs`); pure functions take it as a last parameter defaulting to `unreal`, so S2 code paths are byte-for-byte the old ones.
- W3: per-person store keys that mean different things per pack are prefixed: the role is `role:<person>` for Unreal (unchanged), `role:web:<person>` for web, `role:core:<person>` for core. Trap counts stay machine-wide, but each pack only offers its own traps as rules (an S2 trap never shows in a web repo, and the reverse).
- W4: the web pack writes lane heartbeats and away ledgers without an intent under `.ather/local/` (S2 keeps `Saved/AtherAutomata/`); debriefs go to `docs/intent/<slug>/debrief.md`. See F-2 for the gitignore line.

## Reconciliations

<!-- rev <old> -> <new>: still valid <...>; redo <...>; dropped <...>. -->
