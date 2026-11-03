# Ather Automata auto-track: Prompt Log

Append-only. Each user prompt verbatim, with credentials and machine paths redacted.

## L-1 (2026-11-03) | class: intent | -> rev 1

> Ok, xong thì release luôn nhé

Hai's go, given to the orchestrator on the mechanism below, which he approved (relayed in the worker's brief, 2026-11-03):

1. A worker's (subagent's, agentId set) edits count for the parent session too, not only main-thread edits.
2. An edit to any file in docs/intent/<slug>/ counts, not only prompt.md and log.md.
3. A commit whose message starts with `intent(<slug>)` counts (a git commit seen in a Bash/PowerShell tool call, for an existing intent folder).
4. A session that already tracks intent X switches to Y only after X has had no such activity from this session for 30 min; before that, Y does not take over.
5. Never take an intent that another live session tracks: an auto-track does not steal. The existing "second session" display still covers deliberate tracking.
6. When the tracked intent's Status becomes completed or parked, the session's auto pin is removed (auto-untrack). A deliberate track is left alone, or untracked the same way; decide, and write the decision down.
7. `/ather untrack` stops stay respected: an auto-track never re-pins an intent the person untracked in that session.

Hai declined a morning digest. Measured before: only 4 of 75 sessions in a week tracked an intent. Release as ather-automata 0.7.0; no push, no PR: commit on the branch and report back.

## L-2 (2026-11-03) | class: intent | -> rev 2

The orchestrator relayed Fable's adversary review of the branch (12 findings) with: fix them on the same branch, no push; for each one, fix it with a test that fails without the fix, or say with a trace why it is not real; the by-design ones get a line in Decisions or the README. The findings, in short: (1) a pin can be taken during an away window; (2) answering a Home decision tracks its intent (breaks track-guard A2); (3) any docs/intent folder counts, even outside a checkout; (4) Paseo passes the agent's root, not the file's; (5) roots compared as plain strings; (6) a branch switch drops an auto pin; (7) `--dry-run` and `|| true` commits pin; (8) only the first commit segment is read; (9) the race between two sessions: accepted, write it down; (10) a deliberate pin is not restored when the auto one that replaced it is dropped: restore it (preferred) or write it down; (11) the blocked check runs even when the 30-min rule refuses; (12) tests for a write outside a checkout, a Windows backslash path end to end, and the Paseo cross-checkout write. Keep state.mjs at or under 999 lines and console.mjs from growing; syncs, gates, review until pass, mutation check on the new pieces; progress S4 and the PR draft.
