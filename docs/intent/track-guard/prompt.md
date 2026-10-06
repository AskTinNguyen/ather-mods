# Ather Automata track guard

- Rev: 2
- Status: active
- Area: ather-automata
- Owner: HaiHuynh
- Skill: `plugin-authoring`
- Branch: `intent/track-guard`
- Started: 2026-10-06

## Goal

A session tracks the intent it works on, and only by a deliberate act. Today one press on any intent row (or a matching word typed anywhere in Ather) pins that intent to the session with no way back; the pin then shapes every prompt (lane text), takes the session's builds, tests and PIE as that intent's proof, shows the session as working on it to every other lane, and moves the person's "Continue …" suggestion in every fresh session. Several sessions on one intent are not shown either. Fix it in Ather's core so that looking at an intent never tracks it, tracking can be undone, and a second session on an intent sees that it is the second — with no new dialogs and no change to the pane for anyone who never hits the problem.

## Non-Goals

- An orchestrator lease or lock per intent. Several sessions on one intent are legitimate (orchestrator, a separate reviewer, a resumed session); they are shown, not prevented.
- Confirm dialogs. They fire hardest on the legitimate cases and do nothing in sessions without a dialog.
- Changing evidence semantics: proof stays shared per intent (Tin's design, 24 h TTL); only who produced it becomes visible. Owner-only evidence scope is a follow-up for Tin (see Follow-ups).
- The S2 skills that call Ather (the `ather-tour` skill tracking through the profile tool, the intent skill's "no intent"): separate S2 PRs once this lands.
- Away windows, Needs you and the phone/Remote Control path: unchanged (untrack is refused while a window runs).

## Sources

- Adversarial reviews of the first proposal (2026-10-06): a code/state review and a workflow/UX review. Both found that the proposal's confirm dialog (P2) and warning (P5) add friction on legitimate cases; both found the missed one-press and silent pin paths (typed words, intent rows, worker writes, `last:<me>`), and the missing proof attribution. Their evidence lines: `state.mjs:266-275` (track only overwrites), `watch.mjs:165-168` (auto-track on any intent write, worker calls included, before the tool runs), `console.mjs:505,539-547,566,1159,1343,1355,1358` (one-press paths; "Read-only" rows that track), `home.mjs:190,201` and `state.mjs:272` (`last:<me>` drives "Continue …"), `state.mjs:137-140,154-158` (evidence scoped by the pinned slug, no producer), `state.mjs:106-120,414` (/clear and window adoption carry the pin), `watch.mjs:20,82,252,321-322` (heartbeat every 30 s, alive 10 min, peers in lane text, no reader in the pane).

## Decisions

- D1 (rev 1): Two acts, not one: looking at an intent opens its view; working on it is an explicit "Work on this here" in that view. The Next card ("Continue X", "Pick up X") and the phone path keep their one press: their label is the verb. Source: L-2 reviews.
- D2 (rev 1): Untrack keeps the proof already recorded (in the legitimate case — work done, then untracked — moving it would destroy the intent's proof); the `by` stamp (D3) makes misattributed proof visible instead. Source: engineering, from the reviews' disagreement.
- D3 (rev 1): Every evidence record carries `by` = the producing session's first 8 hex; proof produced elsewhere is labelled with it. Source: L-2 reviews.
- D4 (rev 1): "Held by" comes from the live lanes on this checkout with their last activity, never from a lock; heartbeats are written at once on track and untrack. Source: L-2 reviews.

## Acceptance

- A1: Untrack: `/ather untrack`, a **Stop tracking** button in the Intent view, and the profile tool's `track: "none"` clear the session's pin, clear `last:<me>` when it names the same intent, stop auto-tracking from re-pinning that intent in this session, and rewrite the lane heartbeat at once; refused while an away window runs ("End the away window first."); running workers and Needs you are untouched; the reply says proof recorded so far stays with the intent. Proof: gate: unit tests in `tests/ather.test.mjs` and an e2e check in `dev/e2e/run.mjs`.
- A2: Looking never tracks: a press on a home row (Also yours, Follow a teammate), an Everything-open row, or words typed in an Ather dialog or after `/ather` that match one intent open the Intent view for that slug without tracking — except in the Work question ("What should this session work on?"), whose typed name tracks when it matches one intent, as its choices do (F-1 b); the view offers **Work on this here** (tracks and sets `last:<me>`) when this session does not track it; `/ather intent <exact slug>` still tracks with no dialog (sessions without a pane included); the Next card and the phone path are unchanged. Proof: gate: e2e checks, including a session with no pane.
- A3: Auto-track only for the session's own orchestration: a main-thread (no `agentId`) Write, Edit or MultiEdit of `docs/intent/<slug>/prompt.md` or `log.md`, checked after the tool ran; a write that creates `prompt.md` switches the pin to that intent; worker writes and other intent files never pin. Proof: gate: e2e checks (worker `progress.md` write, main-thread `log.md` write, capture of a new intent while another is tracked).
- A4: Held by: the lane record carries `lastActiveAt` (last prompt or tool call); the Intent view and the lane text show one line when other live sessions on this checkout track the same intent — "Also tracked in <n> other session(s) · <age>" — and nothing otherwise. Proof: gate: unit test for the line, e2e with a peer lane fixture.
- A5: Proof attribution per D3: records stamped `by`; the view's proof text names the session when it is not this one; the `status` tool exposes `by`. Proof: gate: unit tests.
- A6: `/clear` and the adoption of an away window keep the pin (unchanged) and toast "Still tracking <slug> · /ather untrack". Proof: gate: e2e check.
- A7: No regression: `node --test ather-automata/tests/*.test.mjs` passes; `S2_ROOT=<S2 checkout> node dev/test-all.mjs --layouts <dir>` passes except the failure already on `main` (`184/185` on 24eb1f4: "a teammate's name sits in its own column at the right edge", which follows the S2 checkout's intents); every layout is identical to the base run except a named list (the Intent view, the rows that now open it), and that diff goes in the PR; `claude plugin test ather-automata` and `claude plugin validate ather-automata` pass. Proof: gate: the commands, against a base run on 24eb1f4 with the same S2 state.
- A8: Release and review: version bump in `ather-automata/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`, a Changes line and the README section on tracking; a PR to `main` for Tin's review whose body states the bug, the two reviews' verdicts, what changed per acceptance item, the layout diff, and the follow-ups. Pushed only with Hai's go. Proof: review (Tin).

## Follow-ups (not in this PR; listed in its body)

- Owner-only evidence scope: a follower's proof would then never move a teammate's stage, at the cost of a helper's builds no longer counting (`state.mjs:137-140`).
- Web pack `with-proof` merges accept proof from any session on the intent (`watch.mjs:508-514`); with `by` they could require this session's proof.
- S2 `ather-tour` skill: view, then "Work on this here", instead of the profile tool's `track` (`.agents/skills/ather-tour/SKILL.md:67`); intent skill: "no intent" calls the profile tool with `track: "none"`.

## Constraints

- Work only in the worktree `D:/Projects/ather-mods-wt/track-guard` on `intent/track-guard`; the main checkout `D:/Projects/ather-mods` is what every session loads Ather from, and another intent runs there.
- Keep Ather's own conventions: state only through `state.mjs`, background hooks never block the calls they watch, plain short wording.
- No push, no PR without Hai's go.

## Changelog

- rev 1 (2026-10-06): created from L-1, L-2 and the two adversarial reviews.
- rev 2 (2026-10-06): L-3: F-1 (b), a name typed in the Work question tracks like its choices.
