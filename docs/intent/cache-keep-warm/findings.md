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

## F-2 (2026-10-11, rev 2) | blocking: no | status: accepted (engineering)

**Found:** In live sessions (Claude Code 2.1.295, Opus 5.5, scratchpad `live/out-run1`), the first read after a session's first turn missed: session C read 27,862 tokens (the system prompt and tools every session shares) and session D 30,452 of 46,130, writing 15,679. Session C's own second turn, 3.5 minutes after its first, read only 30,391 and wrote 15,907: the main thread did not read its first request's entry either, so the fork's miss was right, there was nothing to keep. After the second turn the fork read 46,273 of 46,300 tokens ("kept"). In the final A/B run, whose first turn made three requests (a Read and its result), the second turn read 101,152 of the first turn's entry: what no later request reads is the session's first request.
**Proposed amendment:** no read before the session's second main-thread turn (a single-request first turn is the common case of the effect, and the guard costs one idle period at most); TTL calibration ignores the second turn, which re-writes that first entry; `/warm` shows the last read's figures, so a person sees a miss for what it is.
**Resolution:** D10, rev 2.

