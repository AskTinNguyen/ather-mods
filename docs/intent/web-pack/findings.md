# web-pack: Findings

Discoveries that may change the intent. The worker adds entries; the orchestrator resolves them.

<!--
## F-<n> (<YYYY-MM-DD>, rev <r>) | blocking: yes | no | status: open | accepted | rejected

**Found:** <what, with evidence>
**Proposed amendment:** <the change to prompt.md>
**Resolution:** <decision and resulting rev, filled by the orchestrator>
-->

## F-1 (2026-10-06, rev 1) | blocking: no | status: accepted

**Found:** the A1 gate `node --test ather-automata/tests/*.test.mjs` fails on `main` (`2f25364`) before any change: `ERR_MODULE_NOT_FOUND: Cannot find package 'claude-code'`. The tests import `claude-code/testing`, which only `dev/test-all.mjs` rewrote to its shim. Separately, `claude plugin test ather-automata` (A7's gate) answers `no *.test.ts or *.test.tsx under ather-automata`: it runs only `.test.ts`, so the `.mjs` tests never run under it.
**Done (worker, in scope):** `dev/test-all.mjs` now links a gitignored `node_modules/claude-code` at the repo root to `dev/shim/node-test.mjs` (describe/test from `node:test`, the shim's expect), so after one `node dev/test-all.mjs` the plain gate runs: `ℹ pass 75 ℹ fail 0`. For A7 the worker added `tests/plugin.test.ts`, which loads the plugin through the engine's kit (`2 pass 0 fail`).
**Proposed amendment:** A1's proof reads "`node --test ather-automata/tests/*.test.mjs` passes (after `node dev/test-all.mjs` has linked the test kit once)".
**Resolution:**

## F-2 (2026-10-06, rev 1) | blocking: no | status: accepted

**Found:** han-viet's `.ather/profile.json` (main `5b71d7f`, format v1 in `tests/ather-profile.test.mjs`) and the web pack agree: `pack`, `gates[] { id, command, proofs[], proves }`, `production { host, branch, deployment, probe { url, expectStatus } }`, `mergePolicy: "with-proof"`, `devPorts { base, perWorktree, env }` are read as written (unit test "the han-viet profile reads as written"). Two gaps: (1) the profile has no list of the gates a merge requires, so the pack takes every declared proof except production (tests, build, lint/typecheck, ui); (2) the web pack writes lane heartbeats, and away ledgers when no intent is tracked, under `.ather/local/`, which han-viet's `.gitignore` does not list.
**Options:** (a) add `.ather/local/` to han-viet's `.gitignore` and, if a narrower merge rule is wanted, an optional `"required": ["tests", "build", "lint", "ui"]` to the profile (the pack already reads it); (b) move web local state outside the checkout (for example under the user's Claude config), at the cost of lanes no longer being per checkout.
**Recommendation:** (a), in han-viet's next intent; nothing in this intent changes.
**Proposed amendment:** none to this prompt; a Constraint line for han-viet's profile owner.
**Resolution:**

**Resolutions (orchestrator, 2026-10-06):** F-1 accepted: the unit gate needs the link that `dev/test-all.mjs` creates, so run that first; noted here instead of a rev bump. F-2 accepted: han-viet ignores `.ather/local/` in a follow-up PR; `"required"` stays optional.
