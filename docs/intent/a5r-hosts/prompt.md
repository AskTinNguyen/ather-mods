# A5R hosts: work that moves to other machines

- Rev: 5
- Status: draft (design)
- Area: a5r
- Owner: HaiHuynh
- Skill: `plugin-authoring`
- Branch: `intent/a5r-hosts`
- Started: 2026-11-09

## Goal

A5R coordinates sessions on one machine and one checkout. People also have other machines (a second PC, a rig, a teammate's idle PC, a build bot, a short-lived VM). Today a session that cannot start (RAM, Editor held, sync freeze) can only wait. This intent lets a lane run elsewhere, at three levels that each add something and none is required:

- **L0, suggest and record.** No host declared, no transport. A5R says "this would fit better on another machine" when it can tell, and records "this lane runs elsewhere" (machine label, branch, PR, claimed paths) so local sessions and acceptance see it.
- **L1, read host status.** A declared host plus a reach adapter lets A5R read that host's card (free RAM, Editor holder, availability, freeze) and make the suggestion from facts.
- **L2, hand off and run.** An adapter that can run or deliver lets A5R send a job, follow it, and take the result back as a PR, branch or report.

Nothing is specific to one person's setup: no machine names, no task-kind fields baked in, no assumption that any machine or session uses herdr, SSH or A5R. Every setup step is a check an agent can run, with pass/fail and a fix, because agents configure hosts, not humans editing JSON.

## Non-Goals

- A scheduler or arbiter service. Like the Editor queue, everything is a pure function of files each side reads; the origin side suggests, never places work by itself above L2's explicit hand-off.
- Moving uncommitted or unpushed work. A job's base is a pushed ref.
- Merging binary assets across machines. One machine per asset set; the claim is the lock.
- Replacing a job queue system. The job file is exportable to one; A5R does not become one.
- Running arbitrary remote commands. Only what the host owner configured in the adapter.
- Moving secrets. Jobs carry none; credentials live on each host.
- Changing the existing per-machine Editor holder, RAM or Sync main rules. Hosts add to them (D9, D10).

## Sources

- Hải's requirements (09/11): many people on different machines; nothing specific to his setup; full structure and full protocol; agents configure it; value scales with what a user has.
- Existing A5R decisions this keeps: one writer per file; files are the truth, notices are doorbells (D6 of the A5R intent); refusal format `A5R · <gate> — <why> → <next>`; per-machine options in `pluginConfigs."a5r"` (like `editorLock`, `engineRoot`); `Saved/A5R/status.json` for outside viewers (A134, A139, A141); the Editor request queue as a pure function of files (D3); acceptance (nghiệm thu) over the branch diff; A5R never asks or waits at a hook.
- Failures measured 09/11 (each becomes a health check, section 7):
  - S1 An IT-pushed sshd `AllowGroups` blocked one direction while the other worked.
  - S2 (corrected in rev 3) While OpenSSH `DefaultShell = powershell.exe` was set on a Windows host, the multiplexer from the second machine failed (`sent nothing for 45 s`) and it worked right after the value was removed: one before/after, the mechanism not proven. The `b a c` -> `???` reading taken then was a Windows `sort.exe` artifact (it reads LF-only input as UTF-16, with no shell involved; F-b4), not proof that stdin was corrupted. The multiplexer's handshake never got an answer, it reconnected every ~48 s, each dropped session left an orphan process pair in session 0 (32 pairs, ~300 MB, 25 min, killable only elevated).
  - S3 Credentials differ by logon: a plain SSH logon had no GitHub/LFS credential; the desktop logon (through the multiplexer) had them.
  - S4 A full lane worktree was ~632 GB / 770k files on plain NTFS; lanes are created once and reused, disk estimated first.
  - S5 Two machines can share one Claude account (one usage limit).
  - S6 Until the reverse link worked the host could not wake the origin session: the protocol must work by polling.
- Machine-profile traps already in force: Windows-written logs have CRLF; never create an extra full worktree of a huge repo by hand (health check C9 does it once, deliberately, after C8).

## Scenarios

| # | Scenario | Level | What the user gets |
| --- | --- | --- | --- |
| 1 | Solo, one machine, no hosts | L0 | Nothing new on screen. A5R behaves as today. If the user records a hand-off by hand (`/a5r handoff record`) it appears as a row. No tile, no tool noise. |
| 2 | One person, two machines | L0 to L2 | L0: "queue waits on RAM; another machine could take it" is a hint only if a host is declared; otherwise a one-line pointer to `/a5r host add`. L1 after `host add` (reach + probe). L2 when the adapter can run or deliver. If both run A5R each publishes its card; if only one does, the other is a probe-only host (6). |
| 3 | Team, others' machines, idle capacity (nights) | L1/L2 | A teammate's machine is a host whose owner set availability (window or free text) and an allow list. Origin sees "available until 07:00" and may propose; the host owner's A5R (or the owner) accepts. Nothing runs without that host's `accept`. |
| 4 | Unattended bot/build machine with a queue | L2 | A job file in the exportable format (section 5) is the unit; the adapter may be `command` (submit to the queue system). `roles` tags say what it takes. Results return as PR/report; heartbeat by file or by the queue's own status via the adapter's `status` op. |
| 5 | Short-lived VM / sandbox | L2 | Host with `ephemeral: true`: `until` is set, lanes are not reused, the host card carries `until`, the job's result must be pushed before `until`; at `until - warn` the job gets the preemption notice (D8). |
| 6 | Host without A5R (plain `Saved/EDITOR_OWNER.txt` or nothing) | L1 probe / L2 | The card is built by `probe` through the adapter: reads the lock file and process list if allowed; fields it cannot read are `unknown`, never guessed. A job runs as a plain command, tracked by heartbeat file the job's runner writes (section 5.3). |
| 7 | No transport at all | L0 + manual | Adapter `manual`: A5R prints a hand-off packet (job file as readable text plus the exact next steps for a human); a human carries it and later pastes the result line back (`/a5r handoff result <id> <ref>`). Same states, same file. |

## Decisions

- D1 (rev 1): **Three levels, additive.** A level's features appear only when its inputs exist: L0 needs nothing, L1 needs a declared host and an adapter with `probe`, L2 needs an adapter with `run` or `deliver`. A missing level is never an error; `/a5r host status` says which level this machine is at and what the next level needs.
- D2 (rev 2, R1, R2): **Two option blocks, declarations only.** `pluginConfigs."a5r".hosts` (outbound: machines this one sends to) holds only what the origin decides: id, label, owner, reach, repo, engine rule, and for a probe-only host an `assumed: { roles, availability }` clearly marked assumed. `pluginConfigs."a5r".asHost` (inbound: this machine when it serves others) holds what the host owner decides: roles, laneRoot, capacity, availability, trust, ephemeral, maxJobs, coordinationRoot (D19). The origin never stores a host's `asHost` facts: it reads them from that host's card. Only `/a5r host ...` and the `host` tool write either block, after the checks the change needs pass; hand edits are read, flagged `edited-by-hand`, and re-checked. Machine-local, never in git. Options hold no state (D20).
- D19 (rev 2, R5): **One coordination root per machine.** A lane on a host is a second checkout on the same RAM and Editor capacity. Every session of a job (and every local session) uses the Editor holder, RAM gate and sync freeze of the machine's primary checkout, named in `asHost.coordinationRoot` (default: the checkout A5R runs in; `host check` fails C10 if two roots are declared for one machine). A lane's sessions read and write the Editor queue under `<coordinationRoot>/Saved/A5R/`, not under the lane's own `Saved/`. R5 is therefore decided here, not left open.
- D20 (rev 2, R2): **State lives in files, not options.** Checks with `checkedAt`, derived `level`, `pausedUntil` and link-storm counts go to `<coordinationRoot>/Saved/A5R/hosts/<id>/state.json`, one writer (the origin's `host` tool). The rule is per coordination root, which is per machine (D19), not per checkout, so several checkouts of one machine share one state and one `link.jsonl`.
- D21 (rev 2, R3): **Delivery is always origin to host.** The origin writes a copy of its own hand-off into the host's `Saved/A5R/inbox/<id>.json` with `writeFile` (the origin is still the only writer of that file); the host writes `jobs/<id>.json`; the origin reads it with `readFile` on its tick. Every L2 flow needs only the origin-to-host direction. The host's `deliver` doorbell to the origin session is optional. C12 runs the round trip with the reverse direction absent and must pass.
- D22 (rev 2, R4): **A job obeys the host's Editor rules.** A job runs as a session on the host and requests the host's Editor through that host's own queue (D19), RAM gate and sync freeze like any local session; the card lists it in `editor.queue`. On a probe-only host the job holds the plain `Saved/EDITOR_OWNER.txt` protocol that host uses; if that cannot be read, a job that needs the Editor is declined (`NO_EDITOR_PROTOCOL`).
- D3 (rev 1): **No machine-specific fields.** `roles` is a free-form list of strings the user chooses (A5R only matches them exactly against a job's `wants`); `label` is free text; `availability.reason` is free text. A5R has no built-in role names. Defaults are empty.
- D4 (rev 1): **The adapter is a small interface** (section 6) with four stock kinds (`ssh`, `herdr`, `command`, `manual`). `command` is a template with named placeholders, which is how any other transport (cloud CLI, queue client) plugs in without code. A5R depends on none; `manual` always works.
- D5 (rev 2): **One writer per file, both sides.** The origin side writes `Saved/A5R/handoffs/<id>.json` (the ask); the host side writes `Saved/A5R/jobs/<id>.json` on the host (the answer and progress). The ask reaches the host by D21 (an inbox copy); the host's answer is read by the origin through `readFile`; for `manual`, what the human carries back is pasted into a file the origin's tool owns (`Saved/A5R/handoffs/<id>.manual-in.json`). Changes are new fields, never overwrites of the other side's file.
- D6 (rev 1): **Files are the truth, notices are doorbells, polling always works.** `deliver` may ring the other side's session; if it cannot (no reverse link, S6), the receiving side finds the change by reading on its minute tick. No state exists only in a message.
- D7 (rev 1): **A job's base is pushed.** `base` is a remote ref and sha. Creating a hand-off with a base the remote does not have is refused (`A5R · handoff — base abc1234 is not on origin → push the branch, then create the hand-off`). Uncommitted or unpushed local work is never part of a job.
- D8 (rev 2): **Availability and preemption.** The host owner sets `asHost.availability` (published in its card; R1). `availability = { state: yes|no, reason, windows[], until }`; `windows` is optional recurring text-free spans (`days`, `from`, `to`, host-local time zone named). The host owner (or its A5R) sets it. A change to `no`, or `until - warn`, writes `preempt` into each running job's file: the job's session gets a notice to reach a safe point, push a WIP branch, and `park`. Parked jobs can resume when availability returns or be `returned` to origin. Reason is shown only when state is no.
- D9 (rev 1): **Claims are visible and checked at the action and at acceptance.** Open hand-offs' `claims` (paths, globs, asset sets) are read by every local session. A local edit to a claimed path is recorded (`rule=claim-touch`) at the hook and refused only for paths marked `exclusive` (binary assets default exclusive, text defaults shared); acceptance fails a diff that touches another open hand-off's exclusive claim without a reason in progress.md. Rule 1/3 text in the A5R intent is extended by reference, not rewritten.
- D10 (rev 1): **Sync main stays per machine.** The local sync does not gate remote lanes (they branch from `origin/main` and PR). At the cutoff, A5R warns about open hand-offs whose `base` is not an ancestor-pushed ref or depends on local unpushed work (should not exist by D7, but a branch moved after creation is checked) and about hosts that report their own freeze (the card's `freeze` field). A host with its own sync freeze is `unavailable for new jobs` automatically.
- D11 (rev 2): **Suggestion is a pure function** (`LONG`, default 120 min, is only a suggestion threshold; it never blocks or places anything) `suggest(request, local, cards, options) -> { suggestion: none | host(id, reasons[]) , whyNot: [{host, code}] }`. Reason codes: `RAM` (local free < need, host free >= need), `LONG` (minutes over `hosts.longMinutes`, default 120), `READONLY_WAIT` (read-only task, local Editor held), `FREEZE` (local sync freeze, host not frozen), `IDLE` (host offers capacity now). Why-not codes: `UNAVAILABLE`, `STALE_CARD`, `NO_ROLE`, `NO_TRUST`, `NO_RAM`, `FROZEN`, `UNCHECKED`, `NO_ADAPTER_OP`. Thresholds are options with defaults. It only suggests; a hand-off is always an explicit tool call or command. (rev 4, S-c) A host qualifies when it has no why-not code and at least one of `RAM`, `LONG`, `READONLY_WAIT` (read-only, the local Editor held by another session, waited at least `hostsOptions.readOnlyWaitMin`, default 15 min), `FREEZE` (a local sync cutoff or freeze overlaps the request window, the host card's `freeze` is null). `IDLE` (the host's Editor not running and its queue 0) is only added to the reasons of a host that already qualifies; it never suggests alone (no nagging). The need is the request's `needGb`, else the local launch gate in force (with PIE or without). The pick is the qualifying host with the most free RAM, ties by label. `NO_TRUST` is said only for a card with `acceptsFrom`; a probe card (none) skips the check and notes `trust unknown`. `NO_ADAPTER_OP` is S-d's (a hand-off), never said by suggest.
- D12 (rev 2): **Trust is a host-side allow list.** A host accepts a job only if `from` (origin identity string = the origin's declared `owner` plus a stable machine id, no secret) is in `asHost.trust`, or `trust: ["*"]` (a bot). Origin identity is declared when the host is added; it proves nothing cryptographically, it names who to hold responsible; transport authentication (SSH key etc.) is the real gate. A job from an unknown origin is `declined` with reason `NO_TRUST`.
- D13 (rev 1): **No secrets in jobs, ever.** Job and card files are scanned with the existing `secret_regex` on write; a match refuses the write. Credentials stay on each host (C3 checks they exist, never reads them).
- D14 (rev 2): **Health checks are the setup.** Results are stored in state.json (D20), not in options. `host add` is a sequence of checks (section 7), each with id, pass/fail/skip, measured value, a fix line for an agent, and `checkedAt`. A host's level is derived from which checks passed. Stale checks (default 7 days, or a failing live probe) lower the level and re-run on the next `host check`.
- D15 (rev 1): **A5R-less hosts are first class.** Without A5R the card is built by `probe`; the lane runs a plain runner (a script the host owner or agent installs, section 5.3) that writes the job file. A host with neither adapter ops nor A5R is a declaration only (L0 labels).
- D16 (rev 1): **Reconnect storms are the origin's problem to cap.** Adapters declare `backoff` (min 5 s, max 15 min, factor 2) and `maxReconnectsPerHour`; A5R counts failures in `Saved/A5R/hosts/<id>/link.jsonl` and pauses the host (`state: link-storm`) past the cap, with the refusal `A5R · host <id> — link failed 12 times in 10 min → fix the link (C2), then /a5r host resume <id>`. Orphan leak (C5) is checked, not assumed.
- D17 (rev 1): **Display is conditional.** A Hosts tile appears only when a host is declared or a hand-off is open. Queue rows gain a hint `fits <label> (RAM)` only when a suggestion exists. `status.json` gains `hosts` and `handoffs` (additive, `v` stays 1 with new optional keys).
- D23 (rev 5, S-d brief from t6): **The L2 protocol as built.** (1) The host's status writer (the card's single writer, F-b6) is the only writer of `jobs/<id>.json` besides the job tool: on its minute it answers each new `inbox/<id>.json` with `accepted` or `declined` and a code, checked in this order: the secret scan (`SECRET`), `from` in `asHost.trust` or `*` (`NO_TRUST`), `wants` all in `asHost.roles` (`NO_ROLE`), availability `yes` now (`UNAVAILABLE`), no own sync freeze (`FROZEN`), running plus accepted jobs under `capacity.maxJobs`, default 1 (`BUSY`). A write by the wrong side is refused with an A5R refusal line. (2) A job gets a session only as the host owner said: `asHost.startCommand` (argv, `{packet}`, `{id}`, no shell) is run once at accept in the coordination root (`startedBy: "startCommand"`; it must return at once, F-d1); without it the job stays `accepted`, the host's tile says `job <id> waiting → /a5r job take <id>`, the card counts it in `jobs.queued`, and the job tool's `take` picks the first idle lane under `laneRoot` (none: `→ wait for a lane, or add one (C9)`). (3) Heartbeat: section 4. (4) The origin's status writer reads `<a5rRoot>/Saved/A5R/jobs/<id>.json` of each open hand-off whose adapter has `readFile` and keeps the one copy at `Saved/A5R/hosts/<host>/jobs/<id>.json`; the effective state comes from it; `declined`, `failed`, `returned`, `lost`, `preempt` give one notice to the creating session (`by`) and one compact line (F-d4), `done` a notice only. (5) Delivery: `handoff create` checks D7 and D13, writes the hand-off, then the inbox copy at once when the adapter has `writeFile` (the tick retries a failed write); `manual`: `handoff packet`, and `/a5r handoff result <id> <ref>` writes `<id>.manual-in.json` in the job's form (`source: manual`). (6) A done job's PR goes to the hand-off (`resultPr`) and is scored by the existing after-the-fact scorer (F-d5); `merged` only when the PR is merged (read at most once per 10 min per hand-off) and the score passed or `/a5r pass <id>` was given; a failing score stays at `done` with its lines in the tile; branch and report results: `/a5r handoff merged <id>`. (7) A lane's sessions use `asHost.coordinationRoot`'s Editor holder, queue, RAM gate and sync freeze; a probe-only host whose Editor state and lock cannot be read refuses a PIE or build hand-off with `NO_EDITOR_PROTOCOL`; an adapter with neither `writeFile` nor `manual` refuses with `NO_ADAPTER_OP`. (8) Adapters `herdr` (`hc … --on <target>`; `reach.options.hc`, `deliverTo`) and `command` (`reach.options.ops.<op>` argv templates, placeholders inside one element, `{argv}` a whole element). (9) Checks C3, C7, C8, C9, C11, C12, C13 as the S-d brief gives them; C12 runs only when named (F-d3). (10) Preemption and (11) sync interplay: slice S-d part 2.
- D18 (rev 1): **Account sharing is shown, not enforced.** The card has `account: { shared: yes|no|unknown }`, filled by the host owner or a check that compares an opaque account id hash; the Hosts tile shows "shares usage limit" when yes. A5R never reads or stores account credentials.

## Data structures

All files are JSON, UTF-8, LF, one writer. Times are ms since epoch plus an IANA zone where a wall-clock is meant. `v` is the schema version, readers ignore unknown keys.

### 1. Option schema (`pluginConfigs."a5r"`)

```
hosts: {                          // outbound: machines this one sends to (origin decides)
  "<id>": {                       // id: [a-z0-9-]{1,32}
    label: string,                // free text, shown
    owner: string,                // free text, who answers for it
    reach: { kind: "ssh"|"herdr"|"command"|"manual", target: string, options?: object },
    repo?: { url: string, path?: string },
    engine?: { rule: "same"|"any" },              // "same" default; the detected value is state (D20)
    diskEstimateGb?: number,                      // declared size of one lane; else measured and cached in state (C8)
    assumed?: { roles?: string[], availability?: { state: "yes"|"no", reason?: string } }   // probe-only hosts; shown as assumed
  }
},
asHost: {                         // inbound: this machine when it serves others (host owner decides)
  enabled: boolean,
  coordinationRoot?: string,      // D19: primary checkout whose Saved/A5R holds Editor/RAM/freeze for all lanes
  laneRoot?: string,
  capacity?: { ramGb: number, maxEditors: number, maxJobs: number, diskGb?: number },   // measured, can be overridden
  roles: string[],                // free-form tags, empty by default
  availability: { state: "yes"|"no", reason?: string, windows?: [{ days: string[], from: "HH:MM", to: "HH:MM", tz: string }], until?: ms },
  trust: string[],                // origin ids accepted ("*" = any)
  startCommand?: string[],        // rev 5: argv template ({packet}, {id}), no shell; run once at accept
  ephemeral?: boolean,
  account?: { shared: "yes"|"no"|"unknown" }
},
hostsOptions: { staleCardMin: 10, staleCheckDays: 7, longMinutes: 120, readOnlyWaitMin: 15, needGbDefault: 0, suggest: true, warnBeforeUntilMin: 15 }   // readOnlyWaitMin: rev 4
originId: string                 // this machine's identity for `from` (generated once: owner + random 8 hex)
```

The origin never copies `asHost` facts: it reads them from the host's card (section 2).

### 1b. State (`<coordinationRoot>/Saved/A5R/hosts/<id>/state.json`, D20)

```
{ v:1, checks: { <checkId>: { status: "pass"|"fail"|"skip", value?: string, checkedAt: ms } },
  level: 0|1|2,                  // derived from checks, never edited
  declSum?: string,              // rev 4: the sum of the reach, repo and engine the checks ran against (F-c4)
  engineDetected?: string, labSizeGb?: number,   // cached measurements (C8)
  pausedUntil?: ms, link: { failures: n, windowStart: ms, state?: "link-storm" } }
```

Writer: the origin's `host` tool only.

Defaults: no `hosts` key = L0. Every threshold is an option; none is a constant in code beyond its default.

### 2. Host card, the only place a host's own facts (roles, availability, capacity, trust summary) are read from (`Saved/A5R/hosts/<id>/card.json` on the origin; `Saved/A5R/card.json` on a host that runs A5R)

Writer: the host's own A5R tick (A5R host) or, for a probe-only host, the origin's probe into its own `Saved/A5R/hosts/<id>/card.json`. Never the same file by two writers.

```
{ v:1, at: ms, source: "a5r"|"probe", hostId?: string,
  machine: { label?, os?, freeRamGb|null, totalRamGb|null, freeDiskGb|null, engine?: string },
  editor: { holder: {lane, end|null}|null, queue: n, running: boolean|"unknown" },   // queue: the coordination root's live queue (A16)
  availability: { state, reason?, until? },
  freeze: null | { kind: "sync", until?: ms },
  lanes: [{ id, slug, state: "idle"|"busy", branch? }],
  jobs: { running: n, queued: n },
  account: { shared: "yes"|"no"|"unknown" },
  skew: { ms: number|null },     // on the origin's copy of an A5R card: the skew C4 measured (host minus origin)
  roles?: string[],              // rev 4: asHost.roles (a probe card: the declaration's assumed roles)
  acceptsFrom?: string[] }       // rev 4: asHost.trust, the origin ids the host accepts ("*" = any); ids are not secrets.
                                 //   Absent on a probe card: trust unknown (suggest does not say NO_TRUST)
```

An A5R host's own card is written by its status writer when the content changed, or past half of `staleCardMin` with none (a heartbeat, so a quiet host stays fresh, rev 4). The origin reads it through the adapter at `<reach.options.a5rRoot>/Saved/A5R/card.json` and stores it as its copy with `source: "a5r"` while it is fresh (its `at` corrected by the measured skew), else falls back to the probe card. Probe-built cards mark fields `null` when unreadable. A card older than `staleCardMin` is `STALE_CARD`: used for display, never for a suggestion. `status.json` copies cards (without `lanes[].branch`).

### 3. Hand-off file (origin writer): `Saved/A5R/handoffs/<id>.json`

```
{ v:1, id: "<origin id8>-<yymmddhhmm>-<n>", createdAt, from: originId,
  intent: { slug, branch?: string },
  task: string,                         // plain text, what to do and what to prove
  wants: string[],                      // role tags the host must have (all of)
  base: { remote: "origin", ref: string, sha: string },     // pushed, D7
  claims: [{ path: string (path or glob), exclusive: boolean }],
  needs: { ramGb?: number, minutes?: number, pie?: boolean, build?: boolean, readOnly?: boolean },
  proof: string,                        // expected proof, a command or a named gate
  result: { kind: "pr"|"branch"|"report", target?: string },   // where the answer lands
  host: string,                         // host id, or "any" before accept
  lane?: string,                        // set once the host names it
  state: "proposed"|"cancelled"|"merged",      // origin-owned states only
  note?: string, updatedAt,
  by?: { id8, lane },                   // rev 5 (F-a2): the session that created it (its claims never block it; it is told)
  via?: "adapter"|"manual", deliveredAt?: ms,   // rev 5: L2 delivery (D21); absent on an L0 record
  resultPr?: number, scoreLines?: string[], scoredAt?: ms,   // rev 5: decision 6
  noop?: true }                         // rev 5: C12's no-op job
```

### 4. Job file (host writer): `Saved/A5R/jobs/<id>.json` on the host (or the host dir of a probe-only host through its runner)

```
{ v:1, id: <same as hand-off>, receivedAt, state: "accepted"|"declined"|"running"|"parked"|"done"|"failed"|"returned",
  reason?: string,                      // required for declined/failed/returned: a code + free text
  lane?: string, session?: id8, startedAt?, startedBy?: "startCommand"|"take",
  heartbeatAt?: ms,                     // rev 5: written by the host's minute (once a minute) while the job's session is alive
  progress?: string,                    // one line
  result?: { kind, ref: string, sha?: string },   // PR url / branch+sha / report path
  preempt?: { at, reason, deadline },   // written by host availability change (D8)
  proofRead?: { cmd: string, line: string, ok: boolean },
  source?: "manual", updatedAt }        // rev 5: a manual host's answer pasted on the origin (`<id>.manual-in.json`)
```

### 5. State machine

```
origin: proposed -> cancelled
host:   (absent) -> accepted | declined
        accepted -> running -> done | failed | parked
        parked   -> running | returned
        running  -> returned           (host owner took the machine back with no way to park)
origin: done | returned -> merged      (after acceptance on the origin: PR merged or branch taken)
        failed   -> proposed (a new hand-off id; the old one stays failed)
```

The effective state is computed: if the job file exists its host state wins, except `merged`/`cancelled` (origin). No job file after `staleHandoffMin` (default 30) with a reachable host = `unanswered` (shown, not a state); a running job with heartbeat older than 3 minutes = `silent`; 15 minutes = `lost` (shown, origin may `cancel` or `return`). Rev 5: a hand-off delivered through an adapter with no inbox copy yet is `undelivered`; a preempted job past its deadline is `lost`.

### 5.3 The plain runner (host without A5R)

A script a host owner or agent installs (`runner` spec in the intent's progress: reads `handoffs` delivered to `Saved/A5R/inbox/`, runs the task in a lane, writes the job file with the same fields). It is optional; without it a job on an A5R-less host is `manual` in effect (a human or agent on the host reads the packet and writes the job file by tool). The file format is the contract; the runner is a reference implementation and may be replaced by any queue system that writes these fields.

## Adapter interface

Each op returns `{ ok, value?, error?: { code, text } }` and may be absent (`NO_ADAPTER_OP`).

| Op | Input | Meaning |
| --- | --- | --- |
| `probe` | none | reach test plus a minimal card read; latency recorded |
| `readFile` | host path | bytes of a file (size cap 1 MiB) |
| `writeFile` | host path, bytes | write (path must be under `laneRoot` or `Saved/A5R/` of the host) |
| `run` | argv, cwd, bg: bool | start a command; bg returns a handle; no shell string interpolation of untrusted text |
| `status` | handle | running/exited, exit code |
| `deliver` | message text | ring the other side's session (optional; polling is the fallback) |
| `envInfo` | none | which logon the commands run in (C3), shell, stdin/stdout byte-cleanness helper |

Stock kinds map ops: `ssh` (probe/readFile/writeFile/run via the ssh client, `deliver` absent), `herdr` (all ops via the multiplexer, `deliver` and bg `run` present), `command` (user supplies a template per op with placeholders `{target}`, `{path}`, `{argv}`, `{message}`), `manual` (no ops; `deliver` prints the hand-off packet). Every adapter call has a timeout (default 30 s, a build-class `run` excepted), runs without `2>&1` tricks, passes the command as one argument string, and records `link.jsonl` lines (D16).

## Health checks (setup steps, run by an agent through `/a5r host add` or `host check`)

Each: id, what, pass, fix for the agent. Order matters: a failing check stops later ones that depend on it (marked `skip`).

| Id | Check | Pass | Fix on fail |
| --- | --- | --- | --- |
| C1 | **Reach, both ways that are needed** | `probe` ok; if the host must wake origin (S6), the reverse probe is tried and a failure only lowers `deliver`, never reach | name which direction failed; look for policy blocks on the failing side (S1: a group allow list on the SSH server); ask the host owner/IT; polling stays available |
| C2 | **Byte-clean stdin/stdout** | (a) `b a c` through `sort` returns `a b c`, sent with the line ending the remote reads (CRLF to Windows, whose `sort.exe` reads LF-only input as UTF-16 and prints `???`; LF to POSIX); (b) the 256 values 0-255 hash the same through `git hash-object --stdin` on the host and here (the byte-clean proof); (c) a fixed line printed by the host comes back as sent | the link changes bytes; a possible cause is the host's SSH default shell (S2, e.g. a PowerShell default shell): set the server's default shell to the plain command shell, retest; never use that link for adapters until pass |
| C3 | **Logon and credentials** | commands run by the adapter see git credentials for the repo remote and LFS (a non-interactive `ls-remote` and one small LFS fetch with prompts disabled) | S3: the credential is stored for a different logon; run the one-time interactive login in the logon the adapter uses, or switch the adapter to the logon that has it; never copy secrets through A5R |
| C4 | **Clock skew** | |skew| under 120 s (compare `now` through `run`) | sync time on the host; windows and heartbeats rely on it |
| C5 | **Orphan leak** | process count of the transport's helper pairs does not rise across 3 probe cycles (adapter declares the process name pattern) | S2: kill leaked pairs (may need elevation: report to the host owner); do not declare until stable |
| C6 | **A5R present?** | `Saved/A5R/status.json` or `card.json` fresh on the host (tick within 2 min) | none needed: mark `source: probe`; offer to install the plugin |
| C7 | **Repo and engine** | repo reachable at `repo.url` or `path`; engine detected on the host matches `engine.rule` (same version string by default) | install or select the matching engine; set `engine.rule: any` only if the task kinds do not need a build |
| C8 | **Disk estimate** | free disk >= `ceil(sizeOfCheckoutOnOrigin * 1.2)` for the first lane; the estimate is `hosts.<id>.diskEstimateGb` when declared, else the origin's measured lane size, which is slow for a huge checkout (~770k files) and therefore measured once in the background and cached in state.json (`labSizeGb`, re-measured only on request or when the repo's file count changes by 10 %); filesystem kind recorded (plain, block-cloning) | S4: free space, use a cloning volume if available, or use `readOnly`-only roles; never create the lane before this passes |
| C9 | **Lane create or reuse** | one lane exists at `laneRoot` for the repo at the base sha (created once, then reused per job); creation is run in the background with progress, never over a short SSH call | resume a partial lane; do not start a second full copy |
| C10 | **RAM and one coordination root** | `totalRamGb` read; `asHost.capacity.ramGb` set; free RAM read; exactly one `coordinationRoot` per machine (D19) | record measured value; adjust `maxEditors` |
| C11 | **First build read by its own result line** | a build (if the repo has one) run in the lane ends with the build tool's own `Result:` line read through `readFile`; a missing line is a fail whatever the exit code | fix the build; exit code 0 is not proof |
| C12 | **Round trip** | a no-op hand-off (a read-only job that writes `progress` and `done`) goes `proposed -> accepted -> done` through the real adapter using only the origin-to-host direction (inbox write, job read; D21), with the reverse direction absent | read which file or transition stalled; usually C2/C3 |
| C13 | **Trust** | the host's `trust` list contains this origin's id | add it host-side (host owner) |

Level derived: L1 needs C1 and C2 (and C4 if windows are used); L2 additionally C3, C7, C8, C9, C12 (C11 when the roles include a build). A re-run after `staleCheckDays` or after a link failure re-evaluates, lowering the level without deleting the host.

## Claims across machines

`claims` of every open hand-off (state not merged/cancelled/failed-closed) are read by local sessions through one function `claimedBy(path)`. At the hook: an edit to an exclusive claimed path is recorded (`rule=claim-touch`) and refused with `A5R · claim — <path> is claimed by hand-off <id> on <label> → ask them to return it, or choose other paths`. At acceptance: diff against `origin/main`; a path in another open hand-off's exclusive claim without an entry in progress.md/findings.md is a finding `claim` and refuses the PR with the usual list. Claims clear at `merged`, `cancelled`, `returned` (after the origin takes the branch) or `failed` plus an owner release.

## Display

- Hosts tile (only with a host declared or a hand-off open): one row per host with label, level, availability (reason only when `no`), free RAM, Editor state, `shares usage limit` when set, `stale` when the card is old; one row per open hand-off with state, age, `silent/lost` flags.
- Queue rows: `fits <label> (RAM)` when `suggest` returns one. Nothing else changes in the Editor tile.
- `status.json`: `hosts: [{ id, label, level, availability, card? }]`, `handoffs: [{ id, state, host, claims, updatedAt }]`.
- Compact line only when something needs a person (a `lost` job, a decline, a preempt notice).

## Tools and commands

Model tool `mcp__a5r__host` (actions): `list`, `status` (levels and next step), `check` (run named checks), `add`, `set`, `pause`, `resume`, `remove`, `suggest` (inputs: minutes, pie, build, readOnly, needGb, wants), `handoff` with `create | update | cancel | result | list | packet`. Human commands: `/a5r host list|add|check|pause <id> [reason]|resume <id>|remove <id>`, `/a5r handoff list|record|cancel|result <id> <ref>`, `/a5r host availability <id> yes|no [reason] [until]` (host side). Refusals follow `A5R · <gate> — <why> → <next>` and never wait for an answer. Writers: only the host tool writes `hosts`; `handoff` writes only the origin file; a host-side `job` tool action (`accept|decline|progress|done|fail|park|return`) writes only the job file.

## Acceptance

- A1: With no `hosts` option, no hand-off files and A5R on, nothing in the panel, tools list output, `status.json` or compact line changes from today; L0 `/a5r handoff record` works with no adapter. Proof: gate: `claude plugin test a5r` plus a snapshot test of the tree and `status.json` with hosts absent.
- A2: The option schema (section 1) is validated on read and write; hand edits are flagged and re-checked; levels derive from checks only. Proof: gate: unit tests on `readHosts`/`writeHosts` and `levelOf(checks)` with every check combination class.
- A3: Each health check C1-C13 has an engine test against a mocked adapter for pass, fail and skip, including: the `b a c` stdin case (C2 fail), the credential-per-logon case (C3 fail with the S3 fix text), orphan growth (C5 fail), disk estimate under and over (C8), exit 0 without a `Result:` line (C11 fail), and the dependency skips. Proof: gate: engine tests with mocked adapters; each fix line is asserted verbatim in at least one test.
- A4: Adapter interface: `ssh`, `herdr`, `command`, `manual` pass a shared contract suite on a fake transport; a missing op yields `NO_ADAPTER_OP` not a throw; timeouts, backoff and `maxReconnectsPerHour` pause a host (D16) with the refusal text. Proof: gate: contract tests; a storm test with 12 failures in 10 minutes.
- A5: Host card: an A5R host's `card.json` is written by one writer on the minute tick; a probe-built card marks unreadable fields `null`; a stale card is never used by `suggest`. Proof: gate: unit tests on card building and staleness.
- A6: `suggest` is pure and covers every reason code and why-not code; thresholds come from options; no suggestion ever creates a hand-off. Proof: gate: table-driven unit tests (each row of D11's codes, boundary values, no hosts, all stale).
- A7: Hand-off and job schemas and the state machine (section 5) are enforced: one writer per file (a write by the wrong side is refused), D7 base check, D12 trust decline, D13 secret scan, `unanswered/silent/lost` computed from time; D21 delivery (inbox copy written by the origin, job read by the origin, no reverse link needed). Result return: a result PR opened on the host is scored after the fact through the intent's `- PR:` line (the existing A5R feature); the hand-off reaches `merged` only after that score passes or the person passes it (`/a5r pass`). Proof: gate: unit tests per transition including illegal ones; an engine test of the full path `proposed -> accepted -> running -> done -> merged` with a mocked adapter and of `manual`; a test where a result PR scores failing keeps the hand-off at `done` and out of `merged`; a test of the full path with the reverse direction cut.
- A8: Preemption: availability to `no` or `until - warn` writes `preempt`; the running job gets the notice, parks with a pushed WIP branch, resumes or returns; a job with no answer by `deadline` is `lost` on the origin. Proof: gate: engine tests with a simulated clock.
- A9: Claims: `claimedBy` over open hand-offs; hook records and refuses per exclusive rule; acceptance fails a diff that touches another open hand-off's exclusive claim without a reason, and passes it with one. Proof: gate: engine tests in the accept harness (as A-accept tests today).
- A10: Sync interplay: at the cutoff a hand-off whose base moved off a pushed ref is warned; a host card with `freeze` makes the host `FROZEN`; the local sync never refuses a remote lane. Proof: gate: engine tests with a planned sync and mocked cards.
- A11: Scenarios 1-7 each have an end-to-end test or a recorded manual check, named in progress.md, at the level the Scenarios table gives. Proof: gate: the tests above plus, for scenarios 4 and 5, a fake-queue/fake-ephemeral adapter test; scenario 7 by a `manual` packet round trip.
- A12: Display: Hosts tile only per D17; queue hint only with a suggestion; `status.json` keys additive with `v` 1. Proof: gate: tree snapshot tests on terminal and desktop.
- A13: Setup is agent-runnable: `host add` on a mocked remote runs C1-C13 in order, stores results, stops at the first blocking failure with the fix line, and a second run resumes at the failed check. Proof: gate: engine test of the add/resume flow; an agent-facing doc under `a5r/README.md` states each command and its expected output.
- A14: Files stay under 1,000 lines each (`node dev/check-size.mjs`); new work goes in new modules (`hosts.ts`, `hostcard.ts`, `handoff.ts`, `suggest.ts`, `adapters/*.ts`, `hostchecks.ts`); `$` stays in the host files. Proof: gate: `node dev/test-all.mjs`; `claude plugin validate --strict a5r`.
- A15: Thermo-nuclear review of the branch diff against `origin/main` records `Verdict: pass`; release follows the `release` skill. Proof: review section in progress.md.
- A16: Host Editor rules (D19, D22): a job's Editor/PIE/build request goes through the machine's coordination-root queue, RAM gate and sync freeze and appears in the card's `editor.queue`; two Editors on one machine never run at once; a probe-only host's job follows the plain lock or is declined `NO_EDITOR_PROTOCOL`; two declared coordination roots fail C10. Proof: gate: engine tests with mocked host state and queue.
- A17: State and options (D2, D20): `hosts` and `asHost` hold no state; checks, level, pause and link counts are only in `state.json`, written only by the `host` tool; options written by hand are flagged; one state per coordination root with several checkouts. Proof: gate: unit tests on option/state separation and a two-checkout test.

## Slices (build order; each ships alone and is useful)

| Slice | Content | Level | Acceptance rows |
| --- | --- | --- | --- |
| S-a | `handoff record` (L0), claims visible to sessions, claim check at the hook and at acceptance, no adapters, no hosts option | L0 | A1, A9 (record, claim, acceptance parts), A14 |
| S-b | `host add` with C1, C2, C4, C5, C10 on the `ssh` and `manual` adapters, `hosts` and `asHost` options (D2), `state.json` (D20), Hosts tile | L1 | A2, A3 (C1, C2, C4, C5, C10), A4 (ssh, manual, storm cap), A13, A17, A12 (tile) |
| S-c | Card publishing on A5R hosts, probe-built cards, `suggest` and the queue hint, `status.json` additions | L1 | A5, A6, A12 (hint, status.json), A16 (card queue part) |
| S-d | L2 hand-off over inbox and job files (D21), preemption, C3, C7, C8, C9, C11, C12, C13, `herdr` and `command` adapters, result acceptance, sync interplay, host Editor rules (D22) | L2 | A3 (rest), A4 (herdr, command), A7, A8, A10, A11 (1-4, 6, 7), A16 |
| S-e | Reference runner for A5R-less hosts (F2) and the fake-queue / ephemeral scenarios | L2 | A11 (5, 6 end to end) |

A15 closes every slice that changes code (a review per slice, one release per slice).

## Open questions (findings for Hải; F1-F7 accepted by Hải as written; R5 is decided in D19, so no F8)

- F1: Is the origin's `from` id enough for trust, or should hand-offs be signed? Recommendation: ids only for now; the transport (SSH key, multiplexer) is the gate; revisit when a bot accepts `*` from the internet.
- F2: Should a host without A5R need the reference runner, or is "agent on the host reads the packet" enough for L2? Recommendation: ship the reference runner as a later step; the job file format is the contract; test with a fake runner.
- F3: Should A5R ever place a hand-off automatically (a rule: "RAM waits over 30 min -> propose")? Recommendation: no in this rev; suggestion only, a person or the session decides. Revisit after field data.
- F4: Where does `originId` come from for a team (it must be stable and not a machine path)? Recommendation: generated once, stored in the option, shown by `host status`; an owner may set a readable prefix.
- F5: Should `claims` default to exclusive for text files too? Recommendation: no; text files merge, so only binary assets (`.uasset`, `.umap`, listed globs) default exclusive.
- F6: Does the host card expose branches/PR numbers to outside viewers via `status.json`? Recommendation: counts only for others; branches only on the origin's own file, since the repo may be public.
- F7: One shared Claude usage limit across two machines: show only, or also warn at launch? Recommendation: show only (D18); there is no measured limit signal to act on.

## Constraints

- Never edit `ather-automata/`; never edit the live plugin folder or the S2 checkout; commit on `intent/a5r-hosts` with exact paths; no push without Hải.
- Coordination files live under git-ignored `Saved/A5R/`, never in git, never in `docs/intent/`.
- No fixed-interval model check-ins: reads happen on the minute tick; the model is woken only by an event.
- The repository is public: no machine names, paths or credentials in examples, logs or PRs.

## Changelog

- Rev 1 (2026-11-09): first draft of the design.
- Rev 5 (2026-11-10, slice S-d part 1, decisions from t6's brief): D23 records decisions 1-11 (who answers the inbox and the decline order, how a job gets a session with `asHost.startCommand`, the heartbeat, the origin's copy and notices, delivery, result and merged, the lane's Editor rules, the herdr and command adapters, the checks); section 1's `asHost` gains `startCommand`; section 3 gains `by` (F-a2), `via`, `deliveredAt`, `resultPr`, `scoreLines`, `scoredAt`, `noop`; section 4's heartbeat is once a minute by the host's tick (not every 30 s), and the job gains `session`, `startedBy`, `source`, `updatedAt`; section 5 gains `undelivered`. Findings F-d1 to F-d6. Part 2 (same rev): the preemption is a file of its own beside the job (`<id>.preempt`) and park records the WIP branch as `wip` (F-d9); section 1's host gains `build: { argv, log, success }` and `repo.lfsProbe`; F-d7 to F-d9.
- Rev 4 (2026-11-09, slice S-c): section 2's card gains `acceptsFrom` (asHost.trust, needed for `NO_TRUST`) and `roles` (needed for `NO_ROLE`; F-c1), `editor.holder.end` may be null, the A5R card's heartbeat and the origin's read of it; D11 records the qualifying rule (IDLE only joins a host that already qualifies, never suggests alone), the need, the pick and trust-unknown for probe cards; section 1's `hostsOptions` gains `readOnlyWaitMin` (15); section 1b: the checks' declaration sum (`declSum`) covers only reach, repo and engine, so label, owner and assumed change without dropping the level (F-c4, t6).
- Rev 3 (2026-11-09): C2 row (F-b4, decided by t6): `sort` gets CRLF on Windows and LF on POSIX; the hash of the 256 values on both sides is the byte-clean proof; the default shell is named as a possible cause, not a certain one. Sources S2 corrected: the `b a c` -> `???` reading was a Windows `sort` artifact, not proof of stdin corruption.
- Rev 2 (2026-11-09): review-rev1.md applied. R1: options split into `hosts` (outbound) and `asHost` (inbound), host facts read from the card; R2: state moved to `state.json` per coordination root; R3: delivery always origin to host (D21), C12 without a reverse link; R4: a job obeys the host's Editor queue (D22); R5: decided as D19 (`asHost.coordinationRoot`), no F8; R6: Slices section and A# mapped; R7: result acceptance in A7; smaller: C8 declared and cached size, `LONG` is a suggestion threshold only. F1-F7 kept as accepted.
