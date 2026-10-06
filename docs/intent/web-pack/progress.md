# web-pack: Progress

- Working under rev: 1
- Worker: `web-pack-worker`
- Current step: S4: the web pane in `dev/test-all.mjs` against a han-viet checkout (A6)
- Next step: release 0.1.0 (A7)
- PR: none yet

## Acceptance

<!-- One row per acceptance id in prompt.md, same order. Verdict is exactly met or open; met needs evidence (commit / command and its result line). -->

| Item | Verdict | Evidence |
| --- | --- | --- |
| A1 | met | S2: `node --test ather-automata/tests/*.test.mjs` → `ℹ pass 75 ℹ fail 0`; `S2_ROOT=E:/S2_ node dev/test-all.mjs --layouts` → `75/75 passed`, `185/185 passed`; `diff` of layouts-72 (399 lines) and layouts-110 (83 lines) against a base worktree at `02b9f38` run on the same S2 state: identical |
| A2 | met | S3: `tests/web.test.mjs` "pack selection (A2)": profile first (web beside a .uproject, unreal beside package.json), markers (.uproject, package.json, pyproject.toml, .uproject wins), core alone, bad JSON ignored, read once per session (read count unchanged on a second call, read again in a new session). `node --test ather-automata/tests/*.test.mjs` → `ℹ pass 105 ℹ fail 0` |
| A3 | met | S3: "web proof from tool output (A3)" over 14 outputs captured from han-viet `b5379e5` in a scratch worktree (`tests/fixtures/web/`: node --test, ESLint, tsc, next build, vinext build, Playwright ui:verify, each passing and failing) through the han-viet profile and scripts; vitest and jest from their documented summaries (han-viet has neither). `ℹ pass 105 ℹ fail 0`; `dev/test-all.mjs` → `105/105 passed` |
| A4 | met | S3: "web held actions while away (A4)": vercel/wrangler production deploys, non-local migrations (local ones pass), vercel env / wrangler secret / gh secret and `gh api -X PUT …/actions/secrets`, npm publish, terraform apply, chained commands and `npm run <script>` bodies, merges by `gh pr merge`, `gh api …/pulls/N/merge` and GraphQL `mergePullRequest` held until proven (with-proof), never a push to main or a deploy; S2 still holds merges with proof. `ℹ pass 105 ℹ fail 0` |
| A5 | met | S3: "web traps (A5)": 9 traps (EADDRINUSE, POSIX env on Windows, hydration, stale .next/Vite cache, lockfile drift, Node engines, NEXT_PUBLIC_*, Playwright browsers, .next lock), each with a fix, each matched alone (EADDRINUSE and POSIX env from real han-viet output), none on passing runs; Unreal and web traps never cross. `ℹ pass 105 ℹ fail 0` |
| A6 | open | unit part done (S3: Prove names `npm test` / `npm run ui:verify`, Ship names every gate and the Vercel production check, Create offers the five web skills); the e2e layout against `HANVIET_ROOT` is next |
| A7 | open | |

## Steps

<!-- S<n> (rev <r>, <YYYY-MM-DD>): <what was done>. Evidence: <commit / command and result line / PR>. Acceptance: <A-ids moved>. -->

- S1 (rev 1, 2026-10-06): baseline before any refactor. Added `--layouts <dir>` to `dev/test-all.mjs` (passed to `dev/e2e/run.mjs`; every `check()` layout at 72 and 110 columns written to `layouts-72.txt` / `layouts-110.txt`), and a `node:test` adapter so the plain `node --test` gate resolves `claude-code/testing` (F-1). On base `2f25364`: `S2_ROOT=E:/S2_ node dev/test-all.mjs --layouts base1` → `75/75 passed`, `185/185 passed`; a second run `base2` → identical layouts (`diff` empty, 399 + 83 lines), so the dump is deterministic against a fixed S2 state. `node --test ather-automata/tests/*.test.mjs` → `ℹ pass 75 ℹ fail 0`. Evidence: this commit. Acceptance: A1 (baseline only).

- S2 (rev 1, 2026-10-06): the Unreal specifics moved behind a pack interface. `hooks/packs/unreal.mjs` holds roles and their labels, areas, the five rungs with their detectors (`readShell`, `mcpKind`), required rungs per role, prove/brief/ship/tour/ask prompts, traps, the Editor owner lock (`lockFile`, `parseLock`, `lockRoles`, `ownCheck`), the Skills and Create catalogs, held Editor actions and the mandate words; `hooks/shell.mjs` the shared command-line reading; `hooks/packs/index.mjs` the `Pack` typedef and selection; `core.mjs` and `web.mjs` the other two packs. `model`, `guards`, `home`, `away`, `issues`, `state`, `watch` and `console` take the lane's pack (default `unreal`, so every existing export and test is unchanged). The e2e sandbox gets an `S2.uproject` marker, as a real S2 checkout has. Evidence: this commit; `node --test ather-automata/tests/*.test.mjs` → `ℹ pass 75 ℹ fail 0`; `S2_ROOT=E:/S2_ node dev/test-all.mjs --layouts L-new2` → `75/75 passed`, `185/185 passed`; base worktree at `02b9f38` run on the same S2 state → layouts-72 and layouts-110 identical (`diff -q` silent). Type-check with the engine types reports the same 3 errors as the base (AskUserQuestion missing from this build's tool list), none new. Acceptance: A1.

- S3 (rev 1, 2026-10-06): `tests/web.test.mjs` (30 tests) and fixtures. Captured in a scratch `git worktree add --detach` of han-viet at `origin/main` (`b5379e5`, removed after), with `npm_config_script_shell` set to Git Bash; Playwright from the agent-workflow harness (now han-viet main `5b71d7f`) copied into the scratch copy. Failing runs came from temporary files in the scratch copy only (a failing node test, a conditional hook plus a type error, a broken import, an extra 404 route). Machine paths replaced by `<repo>` and `<home>`. Detector fixes the real outputs asked for: ANSI colour codes stripped, vinext's "Build complete." read as a pass, cmd.exe's `'WRANGLER_LOG_PATH' is not recognized` as the POSIX-env trap. Evidence: this commit; `node --test ather-automata/tests/*.test.mjs` → `ℹ pass 105 ℹ fail 0`; `S2_ROOT=E:/S2_ node dev/test-all.mjs --layouts L-s3` → `105/105 passed`, `185/185 passed`, layouts still identical to the base. Acceptance: A2, A3, A4, A5.

## Decisions (worker)

- W1: layouts are compared per `check()` call in run order; any difference in order, text or count is a regression.
- W2: packs live in `ather-automata/hooks/packs/` (one hooks module per plugin, so the engine loads them as relative imports). A pack is a plain object (`Pack` in `packs/index.mjs`); pure functions take it as a last parameter defaulting to `unreal`, so S2 code paths are byte-for-byte the old ones.
- W3: per-person store keys that mean different things per pack are prefixed: the role is `role:<person>` for Unreal (unchanged), `role:web:<person>` for web, `role:core:<person>` for core. Trap counts stay machine-wide, but each pack only offers its own traps as rules (an S2 trap never shows in a web repo, and the reverse).
- W4: the web pack writes lane heartbeats and away ledgers without an intent under `.ather/local/` (S2 keeps `Saved/AtherAutomata/`); debriefs go to `docs/intent/<slug>/debrief.md`. See F-2 for the gitignore line.
- W5: the web rungs are `tests`, `lint` (lint and typecheck: a profile's `typecheck` proof folds onto it), `build`, `ui`, `prod`. Required for Prove: engineer tests + lint + build, designer ui, product build + ui, each cut to what the profile declares. A merge under `with-proof` needs every declared rung except `prod` (production is checked after the merge). Pass needs the tool's own counts or exit 0 (a piped command's exit is the filter's, so only counts decide); a failure count or a non-zero exit fails; an unreadable run records `none`.
- W6: Create in a web repository offers the five Claude Code skills whether or not the repository has a skills folder (`isGlobal`); review skills are run on the current work, the rest start an intent.

## Reconciliations

<!-- rev <old> -> <new>: still valid <...>; redo <...>; dropped <...>. -->
