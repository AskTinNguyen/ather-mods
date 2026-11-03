# Ather Automata auto-track

- Rev: 1
- Status: active
- Area: ather-automata
- Owner: HaiHuynh
- Skill: `plugin-authoring`
- Branch: `intent/auto-track`
- Started: 2026-11-03

## Goal

A session tracks the intent it is working on by itself, so its lane text, its proof and what other sessions see follow the work without anyone typing `/ather intent`. Today only a main-thread Write or Edit of an intent's `prompt.md` or `log.md` tracks it, and only when nothing is tracked yet (`watch.mjs` tool.call, `state.track(..., { isAuto: true, onlyIfNone })`). MEASURED: 4 of 75 sessions in one week tracked an intent. The track guard's rules stay (docs/intent/track-guard, rev 3, completed): looking at an intent never tracks it, tracking can be undone, and a second session on an intent is shown, not prevented.

## Non-Goals

- A morning digest of what was tracked (Hai declined it, L-1).
- Changing what looking at an intent does, or how a deliberate track (`/ather intent`, Work on this here, the profile tool, Continue) and `/ather untrack` work.
- Changing evidence: proof stays shared per intent with its `by` stamp (track-guard D2, D3).
- A lock per intent: a second session that tracks an intent on purpose is still shown, not refused.

## Sources

- L-1 (Hai, 2026-11-03): the mechanism below, approved, with "release it when done".
- docs/intent/track-guard/prompt.md (rev 3): D1-D5, A1-A4. This intent replaces its A3 ("worker writes and other intent files never pin"); every other row stands.
- Today's code on origin/main 1f48948 (ather-automata 0.6.8): `ather-automata/hooks/watch.mjs` tool.call (auto-track on a main-thread write of prompt.md or log.md), `ather-automata/hooks/state.mjs` `track` / `untrack` (the pin, the `untracked:<sid>` stops, untrack refused while an away window runs).

## Decisions

- D1 (rev 1): A worker's (subagent's) write counts for the session it runs in, as the main thread's does. Replaces track-guard A3's "worker writes never pin". Source: L-1 item 1.
- D2 (rev 1): A write (Write, Edit, MultiEdit that ran) of any file under `docs/intent/<slug>/` counts, not only `prompt.md` and `log.md`. Source: L-1 item 2.
- D3 (rev 1): A `git commit` run in a Bash or PowerShell call that did not fail counts when its first message starts with `intent(<slug>)` and `docs/intent/<slug>/prompt.md` exists in the checkout the commit runs in (`cd x &&` or `git -C x`). The message is read from the command as written, heredoc and PowerShell here-string included; `-F <file>` is not read. Source: L-1 item 3.
- D4 (rev 1): A session that tracks X moves to Y only after X has had no such work from this session for 30 minutes (`AUTO_SWITCH_MS`). The pin carries the time of the session's last work on it (`pinMeta:<sid>`, which moves with /clear and is pruned with the lane); a deliberate track counts as work at the moment it is made. Two exceptions, both from what was there before: the main thread creating a new `prompt.md` has just started that intent and takes over at once (track-guard A3), and a pin never moves while an away window runs (its mandate and ledger were set up for the tracked intent, as untrack is refused then). A pin from before 0.7.0 has no time and counts as idle. Source: L-1 item 4; the exceptions: engineering, kept from track-guard.
- D5 (rev 1): Auto-track never takes an intent that another live session tracks: a fresh heartbeat on the intent's checkout, not ended, naming the slug. Tracking on purpose is unchanged: a second session is shown ("Also tracked in …"), not prevented. Source: L-1 item 5.
- D6 (rev 1): Auto-untrack applies to auto pins only. When the tracked intent's Status becomes completed or parked, a pin auto-track set is removed at the session's next 30-second tick, with no stop (work on it after it reopens takes it again) and with one toast. A deliberate track is left alone: the person chose it, and it goes the way it came (`/ather untrack`, Stop tracking). Nothing is removed while an away window runs. Auto-track also never takes a completed or parked intent, so the closing commit or a last log line cannot pin it again. Source: L-1 item 6 ("decide, and write the decision down"); engineering.
- D7 (rev 1): `/ather untrack` stops stay respected: an auto-track never pins an intent this session untracked, the new-intent exception included. Source: L-1 item 7.
- D8 (rev 1): Taking an intent says so in one toast with the way back ("Now tracking X: this session works on it. /ather untrack stops that."); auto-untrack says so in one toast. No dialog. Source: engineering (track-guard: tracking can be undone, no new dialogs).
- D9 (rev 1): Paseo: ported. The agent's own writes and `intent(<slug>)` commits go through the same `state.track` at turn end, and the tick runs auto-untrack. A worker's writes are not seen there (they are in the worker's own transcript, not the agent's timeline): a line under `## Limits` in `paseo/ather-automata/README.md`. Source: AGENTS.md (decide the Paseo side).

## Acceptance

- A1: A worker's write into an intent's folder tracks that intent for the session (D1). Proof: gate: e2e checks "auto-track A1" in `dev/e2e/repos.mjs` and the auto-track block in `dev/e2e/run.mjs`.
- A2: A write of any file under `docs/intent/<slug>/` counts; files beside the intent folders do not (D2). Proof: gate: unit "auto-track A2" in `ather-automata/tests/autotrack.test.mjs` and e2e "auto-track A2 and A4".
- A3: An `intent(<slug>)` commit tracks the intent in the checkout it runs in; a failed commit, another message or a slug with no folder does not (D3). Proof: gate: unit "auto-track A3", e2e "auto-track A3" (repos), and the Paseo e2e (`dev/e2e/paseo.mts`).
- A4: A tracked intent with work from this session in the last 30 minutes is not replaced by work on another; after 30 minutes it is; a new prompt.md takes over at once; nothing moves while an away window runs (D4). Proof: gate: unit "auto-track A4", e2e "auto-track A4" and "A2 and A4".
- A5: Work on an intent another live session tracks never takes it; tracking it on purpose still does (D5). Proof: gate: unit "auto-track A5", e2e "auto-track A5".
- A6: An auto pin goes at the next tick once its intent is completed or parked, with a toast and no stop; a deliberate pin stays; a closed intent is never taken (D6). Proof: gate: unit "auto-track A6", e2e "auto-track A6" (repos) and the Paseo e2e.
- A7: After `/ather untrack`, no write (main thread or worker) and no commit tracks that intent again in the session; another intent still tracks (D7). Proof: gate: unit "auto-track A7", e2e "auto-track A7" (repos, run.mjs).
- A8: The track guard holds: looking never tracks, untrack undoes, a second session is shown; every existing check passes or is changed only where A3 of track-guard is replaced (named in progress.md). Proof: gate: `node dev/test-all.mjs` (unit, repos, board, lanes, Paseo, S2 e2e) against a base run on origin/main.
- A9: Paseo side per D9: ported in `paseo/ather-automata/server/watch.ts`, the Limits line written. Proof: gate: the Paseo type-check and e2e in `node dev/test-all.mjs`.
- A10: Released as ather-automata 0.7.0: `ather-automata/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `npm run sync` in `paseo/ather-automata`, one Changes line; 0.7.0 is not on origin/main or claimed by open PRs #62, #67, #84. Proof: gate: `node dev/check-release.mjs`, `claude plugin validate --strict .` and `--strict ather-automata`, `claude plugin test ather-automata`.
- A11: Thermo-nuclear review of the branch's diff against origin/main until `Verdict: pass`, and a mutation check: each piece removed once makes a test fail. Proof: review (progress.md step, with the findings and the commits that fixed them).

## Constraints

- Work only in the worktree `D:/Projects/ather-mods-wt/auto-track` on `intent/auto-track` (from origin/main 1f48948); the main checkout is what every session loads Ather from.
- AGENTS.md: no file over 1,000 lines grows (`console.mjs` untouched); `watch.mjs` and `state.mjs` stay under 1,000; stored values only through `state.mjs`; hooks never block or fail the calls they watch.
- No push, no PR: commit on the branch and report back (L-1 brief).

## Changelog

- rev 1 (2026-11-03): created from L-1.
