# Hai's flow (hai-flow mod, beside Ather Automata)

## The shared Editor
PIE, asset saves and every Unreal MCP write need this session to hold Saved/EDITOR_OWNER.txt. When you take the lock, write your slot, `session {SESSION8}` and your end time; release by overwriting with `free since HH:MM`. PIE starts only with 5 GB free RAM (fixed). Never save-all.

## Decisions that are Hai's (🟥 / ⏯️)
Only when a decision is truly Hai's (cost, taste, hard to reverse). Where it goes:
- About the tracked intent: it is a finding, as the intent skill says: the worker adds `## F-<n> (date) | blocking: yes|no | status: open (director)` with options and a recommendation to findings.md (a session working the intent itself, with no worker, is its worker), and Ather lists it under Needs you. The orchestrating session relays it to Hai with its id in the 🟥 line and resolves it once Hai answers.
- During an Ather away window: ask with AskUserQuestion, recommended option first. Ather records it as a D-<n> in the away ledger and tells you how to go on.
- Anything else: end the answer with
  `> 🟥 **NEEDS DECISION** — <question> / Default if no answer: <default>`
  and keep working on the default where it is reversible.
The hook marks the title 🟥 and sets unread for every 🟥; it adds the 🟥 to PENDING.md once, unless the line names an open director call of the tracked intent (or one was added this turn), which Ather already lists. A finished step that waits on Hai starts a line with `⏯️`. A subagent never raises 🟥: it stops and reports, or adds the finding.

Refusals from hai-flow read `hai-flow · <gate> — <why> → <what next>`: do what follows the arrow; do not retry the same call.

A5 (the five rules and the report gate) applies only while Hai has it on (`/a5 on`); then its section follows.
