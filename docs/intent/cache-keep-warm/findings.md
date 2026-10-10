# cache-keep-warm: Findings

Discoveries that may change the intent. The worker adds entries; the orchestrator resolves them.

<!--
## F-<n> (<YYYY-MM-DD>, rev <r>) | blocking: yes | no | status: open | accepted | rejected

**Found:** <what, with evidence>
**Proposed amendment:** <the change to prompt.md>
**Resolution:** <decision and resulting rev, filled by the orchestrator>
-->

## F-1 (2026-10-10, rev 1) | blocking: no | status: accepted (engineering)

**Found:** With `await endWarm($)` in watch.mjs's `session.end` hook, the repos e2e fell from 292/292 to 284/292: the eight checks of "the traced folders" that follow `engine.end('other')` with a new session on the same store (a ninth checkout is added, s2 is "already listed"). Bisected on the stand-in engine: without that one line, 292/292. The extra await moves what the ending session still does past the start of the next session sharing the store and module.
**Proposed amendment:** the warm part of `session.end` does nothing it waits on (D7).
**Resolution:** D7, rev 2; repos e2e 292/292 again.

