# web-pack: Findings

Discoveries that may change the intent. The worker adds entries; the orchestrator resolves them.

<!--
## F-<n> (<YYYY-MM-DD>, rev <r>) | blocking: yes | no | status: open | accepted | rejected

**Found:** <what, with evidence>
**Proposed amendment:** <the change to prompt.md>
**Resolution:** <decision and resulting rev, filled by the orchestrator>
-->

## F-1 (2026-10-06, rev 1) | blocking: no | status: open

**Found:** the A1 gate `node --test ather-automata/tests/*.test.mjs` fails on `main` (`2f25364`) before any change: `ERR_MODULE_NOT_FOUND: Cannot find package 'claude-code'`. The tests import `claude-code/testing`, which only `dev/test-all.mjs` rewrote to its shim. Separately, `claude plugin test ather-automata` (A7's gate) answers `no *.test.ts or *.test.tsx under ather-automata`: it runs only `.test.ts`, so the `.mjs` tests never run under it.
**Done (worker, in scope):** `dev/test-all.mjs` now links a gitignored `node_modules/claude-code` at the repo root to `dev/shim/node-test.mjs` (describe/test from `node:test`, the shim's expect), so after one `node dev/test-all.mjs` the plain gate runs: `ℹ pass 75 ℹ fail 0`. For A7 the worker adds a small `.test.ts` that loads the plugin through the engine's kit.
**Proposed amendment:** A1's proof reads "`node --test ather-automata/tests/*.test.mjs` passes (after `node dev/test-all.mjs` has linked the test kit once)".
**Resolution:**
