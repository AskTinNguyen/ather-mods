# hai-flow A5: Editor holder, RAM and Sync main holder

- Rev: 3
- Status: active
- Area: hai-flow
- Owner: HaiHuynh
- Skill: `plugin-authoring`
- Branch: `intent/hai-flow-a5`
- Started: 2026-10-06

## Goal

hai-flow is Hai's mod beside Ather Automata (it never changes Ather's code). By default Ather looks and behaves exactly as it ships. Turning A5 on (`/a5 on`) adds the five rules and their report gate, and three coordination tools for the sessions that share one S2 checkout and one machine:

1. **Editor holder**: one Editor per machine; sessions ask for a slot, get granted in turn, and hold a lease with a hard end, so they never open or drive the Editor over each other.
2. **RAM**: no session starts the Editor or PIE into an out-of-memory crash; the safe cleanup runs first, then the Editor is allowed.
3. **Sync main holder**: a planned merge of `origin/main` gets a timeline (cutoff, freeze, done) so every session has committed, parked and resolved its conflicts by the right moment, git is held for the sync and released after it, and sessions with conflicts are told to resolve them by the rules.

The three share one clock and one message channel: hai-flow notices, delivered by each session's own hai-flow, never written into an intent's files.

## Non-Goals

- Changing Ather Automata's code or its intent flow (Plan, Build, Prove, Ship; findings; away window; its pane when A5 is off).
- Running the merge itself. The sync holder session still runs it (s2-sync-main); hai-flow coordinates timing, freeze, messages and conflict routing.
- A dedicated scheduler session. The queue is a pure function of files every session reads; there is no arbiter to keep alive.
- Killing processes it did not start, other than the orphans the existing reaper already handles (see A4).
- Other machines: coordination is per machine and per checkout.

## Sources (read before changing behaviour)

- S2 `AGENTS.md` Safety Contract (Editor owner lock; never delete it; Don't-Save; restore backup of only the listed files) — wins over everything below.
- S2 `docs/standards/unreal-editor-session-coordination.md` (live, binding in S2): lock lines `HELD …` / `HANDED …` / `FREE …`; requests ≤ 20 min without a build yield at the holder's next safe point; builds batched into one window ≤ 45 min; at most one interruption per holder per hour; `FREE` after 15 min idle; `background=none` before `FREE`/`HANDED`.
- Paused rules kept as Hai's decisions: `~/.claude/runbooks/runbook-editor-scheduler.md` (leases with a hard end, anchors, liveness before trust, release line, RAM row: PIE ≥ 5 GB to start, < 3 GB abort, never raised; reap orphan git below 14 GB; disk ≥ 20 GB; Live Coding off), `~/.claude/runbooks/runbook-sync-lane.md` (cutoff = sync − 30 min, `Source/` and `Plugins/` frozen from the cutoff, no git writes during the sync, self-conflicts resolve to ours, foreign or binary conflicts abort and go to their owner, never discard a lane's uncommitted work), paused memories `feedback_read_lock_before_write`, `feedback_lock_after_release`, `feedback_no_git_write_during_sync`, `feedback_handover_needs_ack`, `feedback_no_fixed_interval_checkins`, `feedback_pie_gate_fixed`, `feedback_idle_sessions_are_queued`.
- Ather Automata: lane heartbeats `Saved/AtherAutomata/lanes/<sessionId>.json` (30 s; `hasEnded`; stale after 10 min) are how a session knows its live peers; Ather reads the lock with `parseEditorLock` (`free since HH:MM` or a leading `free`; `held by X`; `until HH:MM`; `session <8 hex>`).

## Decisions

- D1 (rev 1): Default look: with A5 off, hai-flow draws nothing into Ather's pane, status line or toasts and gates nothing; only the 🟥/⏯️ title marks stay. Source: L-1.
- D2 (rev 1): Lock lines follow the S2 standard and stay readable by Ather and older scripts: `HELD lane=<lane> session=<name> since=<HH:MM YYYY-MM-DD> pid=<pid|none> end=<HH:MM> mode=<interactive|unattended> pausable=<yes|no> next_safe=<…> note=<what> · held by <lane>, session <id8>, until <HH:MM>`; release `FREE since=<HH:MM YYYY-MM-DD> by=<lane> note=<Editor closed | open PID x> background=none · free since <HH:MM>`. Source: engineering, from the standard and Ather's parser.
- D3 (rev 1): No shared mutable queue. Each session writes only its own request file `Saved/HaiFlow/editor/<id8>.json`; the order (first requested, first served, sync holder first inside a freeze) is computed the same way by every session; only the head takes the free lock, by read-compare-write and a re-read. Source: engineering (no compare-and-set store exists; one writer per file).
- D4 (rev 2): A sync happens when planned, and planning it is a control on the A5 panel: the Sync main tile shows the next sync and its phase and lets Hai plan one (a few preset times, plus `/a5 sync HH:MM` for any time), move it, or cancel it; the session that plans it becomes the holder unless another session is named. No fixed daily windows by default; fixed windows stay an option (`syncWindows`, empty). Source: L-3 (F-1 a), and Hai turned periodic procedures off on 30/09.
- D5 (rev 2): Editor launch gate, adjustable by Hai on the A5 panel (Memory tile) and in the plugin options: free RAM after cleanup ≥ 31 GB for a slot with PIE and ≥ 28 GB without, by default (Editor ≈ 25.7 GB idle and ≈ 31.4 GB at PIE peak on L_TALab, measured 28/09); below it the slot waits and the tile names what holds memory. The PIE gate stays 5 GB start / 3 GB abort, fixed, never raised. Source: L-3 (F-1 b).
- D6 (rev 1): Messages are hai-flow notices, each starting `hai-flow ·`, delivered by the receiving session's own hai-flow: as context on the next tool result mid-turn, or one prompt when the session is idle and the notice needs action (grant, yield request, cutoff, conflict, freeze lifted). Files are the truth; a notice is only a doorbell. No cross-session sends between hai-flow sessions; a standard `UE request:` line is sent only to a holder that runs without hai-flow. Source: L-1 ("tránh ghi vào log của flow intent"); 30/09 automatic cross-session sends were paused after 10.

## Acceptance

- A1: A5 off: Ather's pane tree, status line and toasts are exactly Ather's; no Editor, RAM or sync gate refuses anything; 🟥/⏯️ marks still work. Proof: gate: `claude plugin test hai-flow` (tests compare the wrapped pane with Ather's tree).
- A2: A5 on: one row of three tiles under Ather's strip — Editor holder (holder, until, my place in the queue), Memory (free GB against the launch and PIE gates, what cleanup did, controls to adjust the launch gate per D5), Sync main (branch behind/ahead, next sync and its phase, conflicts, controls to plan, move or cancel a sync per D4) — with the A5 look. Proof: gate: plugin tests on terminal and desktop trees, including the controls.
- A3: Editor holder via a model tool `editor` (request, release, extend, status): request files, deterministic order, a grant only to the head while the lock is free, the slot fits before the next sync cutoff and RAM passes; the lock line written per D2 at grant and at release; direct Edit/Write of the lock refused under A5 with the tool named; a request of ≤ 20 min without a build asks the holder to yield at its next safe point, at most once per holder per hour; lease-end and overrun notices to the holder; a stale lease is freed only when its holder's lane is gone and no Editor process runs (a live Editor with a gone holder is reported, never killed). Proof: gate: unit tests on the pure queue and lock functions, engine tests for grant, yield, overrun and recovery.
- A4: RAM: before a grant the granting session runs the safe cleanup — the S2 reaper `.agents/skills/git-poller-storm/scripts/reap-orphan-git.ps1` when free < 14 GB, and LiveCodingConsole stopped only when no UnrealEditor runs — and reports other heavy processes without killing them; the launch gate per D5; PIE start ≥ 5 GB unchanged; a notice to abort PIE when free < 3 GB while this session's PIE runs; disk below 20 GB reported. Proof: gate: engine tests with mocked probes.
- A5: Sync main holder via `/a5 sync <HH:MM>` and a model tool `sync` (plan, conflicts, done, abort): at the cutoff (sync − 30 min) every A5 session on the checkout gets the checkpoint notice (commit own paths, resume note, release the Editor by sync − 10); grants that would cross the sync are deferred; the holder's conflict list reaches the sessions that edited those paths (hai-flow records each session's edited paths), with the self-conflict and foreign-conflict rules; from the sync time until done/abort, every non-holder session is refused git writes and Editor use in the shared checkout; done/abort lifts it and tells every session. Proof: gate: unit tests on the timeline, engine tests for freeze and lift.
- A6: Notices per D6: at most one idle prompt per session per event; never written into `docs/intent/*` (an edit that adds a `hai-flow ·` line to an intent file is refused); Ather's intent log and findings stay free of them. Proof: gate: engine tests.
- A7: Ather is untouched: no file under `ather-automata/` changes; A5 rules and the report gate keep the 0.3 behaviour (worktree scope, worker stop-and-report, Ather proof). Proof: gate: `git diff --stat main -- ather-automata` empty; `claude plugin validate hai-flow`; type-check; `claude plugin test hai-flow`.
- A9 (rev 3): One machine probe for all A5 sessions: the PowerShell probe runs in one session at a time and is shared through `Saved/HaiFlow/probe.json` (a session probes only when that file is older than 50 s, by read-compare-write so two sessions rarely both probe); every other session reads it; a grant and the cleanup still take a fresh reading. Proof: gate: engine tests (two sessions, one probe per period; stale file re-probed; grant re-probes).
- A10 (rev 3): A lease follows `/clear`: when the session that holds the Editor (or a request, or the sync) is cleared into a new session id, its hai-flow moves its session file, its lock line (HELD with the new `session <id8>`) and its sync holder to the new id, so the cleared session keeps driving the Editor it opened and nobody sees a gone holder. Proof: gate: engine test on `session.end` with reason `clear`.
- A11 (rev 3): At the cutoff the holder's hai-flow lists the files `origin/main` adds that already exist untracked in the shared checkout ("untracked would be overwritten", which merge-tree does not see), by checking each added path on disk (never a whole-tree untracked scan), and sends each to the session whose touch file names it (owner unknown → the holder's notice). Proof: gate: engine test with a mocked `git diff --name-only --diff-filter=A HEAD origin/main`.
- A8: Release: version bump, README (what A5 adds, the three tools, notices, options), loading from `D:/Projects/ather-mods/hai-flow` documented for Hai to switch `CLAUDE_CODE_PLUGIN_DIRS`. Proof: review.

## Constraints

- Never edit `ather-automata/`; hai-flow wraps Ather from above in the hook chain (it must load first in `CLAUDE_CODE_PLUGIN_DIRS`).
- No fixed-interval model check-ins: the mod's minute timer reads files only and wakes the model only on events.
- Coordination files live under the S2 checkout's git-ignored `Saved/` (`Saved/HaiFlow/`), never in git, never in `docs/intent/`.
- Never write inside the mod folder at runtime (hot reload would loop).
- Commit on `intent/hai-flow-a5` with exact paths; no push without Hai.

## Changelog

- rev 1 (2026-10-06): created from L-1, L-2.
- rev 3 (2026-10-06): L-4: A9 shared probe, A10 lease follows /clear, A11 untracked files main would overwrite (F-3 b); F-2 rejected.
- rev 2 (2026-10-06): F-1 decided (L-3): D4 sync planned from the A5 panel; D5 launch gate adjustable on the panel and in options; A2 names both controls.
