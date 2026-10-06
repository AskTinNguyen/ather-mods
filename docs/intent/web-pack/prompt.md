# Ather Automata Web Pack

- Rev: 1
- Status: active
- Area: ather-automata
- Owner: Tin Nguyen
- Skill: `plugin-authoring`
- Branch: `intent/web-pack`
- Started: 2026-10-06

## Goal

Bring Ather Automata from the S2 game project to web app projects. Keep one plugin: a shared core (the pane, Plan → Build → Prove → Ship, Next step, away windows, decision ledger, issues, the worker squad, week-calendar figures) plus one **pack** per kind of project. Today's Unreal behaviour becomes `packs/unreal.mjs` without changing anything S2 sees; a new `packs/web.mjs` serves web repos, piloted on AskTinNguyen/han-viet (Thính).

## Non-Goals

- Changing the S2 experience. Any visible change in an S2 checkout is a regression.
- A Python-specific pack (Node/TypeScript first; the web pack should not preclude it).
- Web watch (CI, preview health) and cloud `/away`; later intents.

## Decisions

- D1 (rev 1): One plugin with packs, not a fork, so core fixes reach both. Source: proposal accepted by the user (L-1).
- D2 (rev 1): Web pack merge policy `with-proof`: merges into `main` are allowed when every rung the profile requires has passed in tool output this session; otherwise held as today. The user delegated merges (L-2). S2 keeps holding merges.
- D3 (rev 1): Pack selection order: the repo's `.ather/profile.json`, then markers (`*.uproject` → unreal; `package.json` or `pyproject.toml` → web), then core only.

## Acceptance

- A1: The Unreal specifics in `model.mjs`, `guards.mjs`, `home.mjs`, `console.mjs` and `watch.mjs` (roles, evidence rungs and their detectors, required rungs per role, prove prompts, traps, the Editor owner lock, the Create catalog, held actions) live behind a pack interface in `packs/unreal.mjs`. Proof: gate: `node --test ather-automata/tests/*.test.mjs` passes, and `S2_ROOT=E:/S2_ node dev/test-all.mjs` passes with every pane laid out at 72 and 110 columns identical to `main`'s.
- A2: Pack selection per D3, read once per session and cached. Proof: gate: unit tests for each branch.
- A3: Web pack roles (Engineer, Designer, Product) and rungs (`tests`, `lint`/`typecheck`, `build`, `ui`, `prod`) with detectors that read results from tool output only: exit code plus pass/fail counts for `node --test`, vitest, jest, Playwright, `tsc`, ESLint, `next build`, vinext/Vite build, and `npm run <gate>` names mapped through the profile. Proof: gate: unit tests over real outputs captured from han-viet (passing and failing) stored as fixtures.
- A4: Web held actions while away: production deploys (`vercel --prod`, `vercel deploy --prod`, `wrangler deploy`), migrations against a non-local database, env and secret changes (`vercel env`, `wrangler secret`), `npm publish`, `terraform apply`. Merges follow the profile's policy (D2). Proof: gate: guard unit tests, including spellings through `gh api` and chained commands.
- A5: At least 8 web traps, each with a fix: `EADDRINUSE`, POSIX env syntax in npm scripts on Windows, hydration mismatch, stale `.next`/Vite cache, lockfile or package-manager drift, Node version vs `engines`/`.nvmrc`, missing `NEXT_PUBLIC_*`, Playwright browsers missing. Proof: gate: unit tests.
- A6: The web Next step and Prove prompts name the profile's gates (for han-viet: `npm test`, `npm run ui:verify`, Vercel production check) instead of S2Editor/PIE wording; the Create list offers web skills (`frontend-design`, `security-review`, `code-review`, `run`, `simplify`). Proof: gate: `dev/test-all.mjs` lays out the web pane against a han-viet checkout (`HANVIET_ROOT`) at 72 and 110 columns.
- A7: Release 0.1.0: version in the plugin manifest and `marketplace.json`, a Changes line, and a README section "Web projects" (profile format, proofs, merge policy). Proof: gate: `claude plugin test ather-automata`; review.

## Constraints

- Background hooks never block the calls they watch; state goes only through `state.mjs`.
- The han-viet profile format is defined jointly with han-viet's `intent/agent-workflow` (its A5). Read `C:/Users/Admin/src/han-viet-wt/agent-workflow/.ather/profile.json` when it exists; if the formats disagree, write a finding instead of guessing.
- Never commit, push or merge on `main` directly; open a PR.

## Changelog

- rev 1 (2026-10-06): created from L-1, L-2.
