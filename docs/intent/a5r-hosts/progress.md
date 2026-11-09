# A5R hosts: Progress

- Working under rev: 3
- Current step: slices S-a (L0) and S-b (L1) built, on `intent/a5r-hosts`, not pushed, no release yet
- Next step: S-c (cards from A5R hosts, suggest, the queue hint). F-b4 resolved by t6 (rev 3). Open: the A51 (desktop, slow) timing flake in the full suite (below). Findings F-a1 to F-a6 and F-b1 to F-b6 in findings.md (F-a3 resolved by Hải: folder claims stay shared).

## Checklist (slices from prompt.md)

- [x] Slice S-a (L0): hand-off record, claims at the hook and at acceptance, pane rows and status.json `handoffs`
- [x] Slice S-b (L1): `hosts`/`asHost` declarations, state.json, ssh and manual adapters, C1/C2/C4/C5/C10, add/resume, storm cap, probe cards, Hosts tile and status.json `hosts`
- [ ] Slice S-c (cards, suggest) / S-d (L2) / S-e (runner)
- [ ] A16 host Editor rules

## S-a: what was built

- `a5r/hooks/claims.ts`: claims (`covers`, `claimOf`, exclusive defaults `*.uasset`, `*.umap` plus the option `claimExclusiveGlobs`), `claimedBy` (open hand-offs only, exclusive first, own-session exemption), `exclusiveHits` for acceptance.
- `a5r/hooks/handoff.ts`: the hand-off file (section 3 plus `by`, F-a2), `parseHandoff`, `writeProblem` (one origin, origin-side states, merged needs a result, D13 secret scan), `checkBase` (D7: `git ls-remote`, then `merge-base --is-ancestor`), `/a5r handoff` parsing, `statusRows`.
- `a5r/hooks/handoffhost.ts`: the host side on closures: tool `mcp__a5r__host` (action `handoff`: create, update, cancel, result, list; other actions answer `A5R · host — not in this version → slice S-b adds hosts`), `/a5r handoff record|list|cancel|result`, the edit check (exclusive claim refused, shared recorded as `claim-touch` after the call ran, hand-off files refused to hand edits), the pane's HAND-OFFS row group.
- Wiring: `a5r/hooks/register.ts` (shrinks 4148 -> 4136 lines: the recorded-action file helpers moved to `a5r/hooks/acts.ts`; one table `A5R_TOOL_ERRORS` in `a5r/hooks/tooldefs.ts`), rule 1 in `a5r/hooks/accept.ts`, `handoffs` in `a5r/hooks/syncplan.ts` / `a5r/hooks/freezehost.ts`, option in `a5r/.claude-plugin/plugin.json`, README section "Hand-off".
- Tests: `a5r/tests/hosts-sa.test.ts` (8 unit), `a5r/tests/hosts-sa-engine.test.ts` (8 engine). Three existing tests that list the registered tools now expect `['editor', 'sync', 'host']` (`a5r/tests/coord-engine.test.ts`, `a5r/tests/old-names.test.ts`, `a5r/tests/rev40.test.ts`; F-a1); no assertion removed.

## Gates (2026-11-09, worktree, uncommitted tree then committed as is)

- `npx -y -p typescript@5.6 tsc -p a5r`: exit 0, no output.
- `claude plugin test a5r`: `837 pass` / `0 fail` / `Ran 837 tests across 76 files. [105.54s]` (final run, after review 2's fix). Earlier runs each had one different 5 s-cap timeout (`RAM: the launch gate comes from the plugin options`, `A51 (desktop, slow): the pane entrance…`), each passing in the other runs (load flakes, not hand-off code).
- `claude plugin validate --strict a5r`: `✔ Validation passed` (one existing warning: no marketplace install line in the README).
- `node --experimental-strip-types a5r/tests/scan-old-names.mjs`: `0 decision-convention strings outside the exceptions, 5 of 5 exceptions in use`; `0 missing`; `0 outside a labelled example`.
- `node --experimental-strip-types a5r/tests/build-script-smoke.mjs`: `… all as expected`.
- `node --experimental-strip-types a5r/tests/merge-script-smoke.mjs`: `… all as expected`.
- `node dev/check-size.mjs`: `size check: passed (138 code files changed).`
- `node dev/test-all.mjs`: FAILED at the unit stage on `FAIL reading a checkout (A1)` (ather-board), which fails the same on the base 586691c (F-a6). `--only repos`: 294/350 here, 294/350 on the base (same count; one flaky pair alternates). `--only board`: `18/18 passed`. `--only lanes`, `--only s2`, paseo and type-check stages: skipped (no LANES_SCRIPTS, S2_ROOT, npm ci, engine types).

## S-b: what was built

- `a5r/hooks/hosts.ts`: section 1 declarations: `declProblems` / `asHostProblems` (validated on read and write; state keys refused, D20), `readHosts` (the options `hosts`, `asHost`, `hostsOptions`, `originId` as JSON text, merged with the machine-local `<home>/.claude/a5r/hosts.json`, the file winning per id; F-b1), `writeHosts` (the one writer; a sum per entry, so a hand edit reads `edited-by-hand`), `reachOf`.
- `a5r/hooks/hoststate.ts`: section 1b `state.json` under `<coordinationRoot>/Saved/A5R/hosts/<id>/` (D19, D20), `levelOf` (L1 = C1 and C2, plus C4 with windows; stale or re-declared checks count as not passed), `link.jsonl` lines, `linkNow` (backoff 5 s doubling to 15 min, the storm at 12 in 10 min or past the hourly cap) and the refusal texts.
- `a5r/hooks/adapters/types.ts` (the interface, `callOp`: a missing op is `NO_ADAPTER_OP`, a throw `ADAPTER_ERROR`), `adapters/ssh.ts` (probe with OS and shell detection, run as one argument string quoted for cmd or sh with a cwd, 30 s default, exit 255 = `LINK`, no answer = `TIMEOUT`, readFile with the 1 MiB cap, writeFile only under `laneRoot` or `Saved/A5R` through stdin, envInfo), `adapters/manual.ts` (no ops; the steps a person runs, `parsePaste`).
- `a5r/hooks/hostchecks.ts`: C1, C2 (sort, 256 values hashed on both sides, a fixed stdout line), C4, C5 (3 probe cycles, rising count fails), C10 (`ramOf`), the fix lines of prompt.md's table, `planOf` (resume at the first check not passed, A13), `runChecks` (the first failure stops the run; `needs C1`; the others `not in this version`), `pastedChecks` (manual).
- `a5r/hooks/hostcard.ts`: the probe card (`source: "probe"`, unread fields `null`, `editorRunning` from the process list), `isStale`.
- `a5r/hooks/hostdesk.ts`: on closures (no `$`): one action table (list, status, add, set, check, pause, resume, remove, suggest) for the host tool and `/a5r host …` (both parsed into one typed `HostInput`; handoff goes on to S-a's desk), D16's guard around every adapter op (`hostPhase`: a storm kept in state.json until resume, a pause, a storm in link.jsonl), the edit check for `Saved/A5R/hosts/`, the minute tick (probe cards by the status.json writer, in the background, after the backoff), one availability rule for status.json's `hosts` and the tile's rows. `a5r/hooks/hostbox.ts` draws the tile (S-a's hand-off rows under it). `a5r/hooks/shape.ts`: `isObj`/`isStrs`, shared by the readers.
- Safety (review 2): an ssh target is never read as a client option (no leading `-`, no spaces; `--` before it); the local ssh client and its config are the person's (`/a5r host add --ssh/--config`; the tool refuses them; a hand-written entry naming them is not probed until `/a5r host add <id>`).
- Wiring: `a5r/hooks/register.ts` stays at 4,136 lines (lines replaced in place: import, options type, tick, freeze closure, desk construction, io, pane, command, tool), `a5r/hooks/handoffhost.ts` (hand edits of `Saved/A5R/hosts/` refused; the tool's non-handoff actions moved to hostdesk.ts), `a5r/hooks/tooldefs.ts` (the host tool's actions and help line), `a5r/hooks/syncplan.ts` / `a5r/hooks/freezehost.ts` (`hosts` in status.json), `a5r/.claude-plugin/plugin.json` (four options), `a5r/README.md` (section "Hosts", in Vietnamese).
- Tests: `a5r/tests/hosts-sb.test.ts` (7 unit), `a5r/tests/hosts-sb-engine.test.ts` (10 engine). One S-a assertion changed (F-b3); no assertion removed.

## S-b live smoke (2026-11-09, read-only, ssh alias of the second machine, Windows, cmd default shell)

- Command: `node --experimental-strip-types smoke.mjs` (scratch script: `sshAdapter` with the system OpenSSH client and `-F <ssh config>`, then `runChecks` C1, C2, C4, C5, C10). Nothing written on the host; the host is not in any plugin config.
- Result: FAILED at C2 (a), because of F-b4, not the link:
  - `C1 pass · windows (cmd), 1121 ms`
  - `C2 fail · sort returned "???" for "b a c": stdin into the host is not byte-clean (…) → the host's SSH default shell mangles stdin (S2): …`
  - C4, C5, C10 `skip · not run: C2 failed`
- The same checks run alone (C1 on file): `C4 pass · skew +5.7 s (limit 120 s)`, `C5 pass · helpers 3, 3, 3 over 3 probe cycles`, `C10 pass · total 63.7 GB, free 42.7 GB`; editor running: false; 107 s (C5's tasklist is slow).
- C2 (b) and (c) alone: the 256 values hashed `0a1c85f95c9a…` on the host and here (same); the stdout line came back as sent. `sort` with `b\r\na\r\nc\r\n` printed `a b c`. This machine's own `C:/Windows/System32/sort.exe` prints `???` for the LF-only 6 bytes too (F-b4).

## S-b, F-b4 resolved (rev 3, 2026-11-09)

- Change: C2 (a) sends CRLF to a Windows remote, LF to POSIX; fail texts and C2's fix line name the default shell as a possible cause; prompt.md rev 3 (C2 row, Sources S2 corrected, changelog). Tests: engine `S-b (A3): engine: C2 fails on the "b a c" -> "???" stdin case …` now also asserts the per-OS sort input and the fix line verbatim.
- `npx -y -p typescript@5.6 tsc -p a5r`: exit 0, no output. The S-a and S-b test files: `32 pass / 0 fail / Ran 32 tests across 4 files`.
- Live (read-only, the second machine, Windows, cmd default shell; scratch script, nothing written there): `C1 pass · windows (cmd), 1547 ms`, `C2 pass · sort a b c; 256 bytes in, same hash; stdout as sent`.
- Full `claude plugin test a5r` not rerun (t6: about 7 GB free RAM on this machine). OPEN: `A51 (desktop, slow): the sync freeze sweep …` timed out at the 5 s cap in two full runs under load (6.1-6.7 s) and passes alone (653 ms); to be rerun when memory allows.

## S-b gates (2026-11-09, worktree, the tree committed as is)

- `npx -y -p typescript@5.6 tsc -p a5r`: exit 0, no output.
- `claude plugin test a5r`: FAILED by one timing test on the final tree: `853 pass` / `1 fail` / `Ran 854 tests across 78 files. [192.34s]`; the failure is `A51 (desktop, slow): the sync freeze sweep plays ten times slower and leaves after its last cell` (`timed out after 5000 ms`, 6.7 s under load), which alone passes (below). A further full run was stopped by Claude Code for low machine memory and not restarted. Earlier full runs on the way: `853 pass / 0 fail` (before review 1's fixes), then two runs with `A51 (desktop, slow): …` timing out at the 5 s cap (6.1-6.7 s under load); that test alone: `(pass) A51 (desktop, slow): the sync freeze sweep … [653.42ms]`, `6 pass / 0 fail` (the load flake S-a recorded).
- The S-a and S-b files alone after the last change: `32 pass / 0 fail / Ran 32 tests across 4 files`.
- `claude plugin validate --strict a5r`: `✔ Validation passed` (the existing README install-line warning).
- `node --experimental-strip-types a5r/tests/scan-old-names.mjs`: `0 decision-convention strings outside the exceptions, 5 of 5 exceptions in use`; `0 missing`; `0 outside a labelled example`.
- `node --experimental-strip-types a5r/tests/build-script-smoke.mjs`: `… all as expected`; `merge-script-smoke.mjs`: `merge script smoke: clean, rules, … killed mid-install and rollback all as expected`, exit 0.
- `node dev/check-size.mjs`: `size check: passed (150 code files changed).` register.ts 4,136 lines (unchanged); largest new file hostdesk.ts ≈350.
- `node dev/test-all.mjs`: FAILED at the unit stage on `FAIL reading a checkout (A1) > origin/main’s intents …` (`72/73 passed`; the base failure F-a6), after `427/427 passed`; copies, paseo and type-check stages ran first. No new failure.

## Acceptance

| Item | Verdict | Evidence |
| --- | --- | --- |
| A1 | met (S-a) | engine test `S-a (A1)`: no hand-off, or only cancelled/merged ones: the A5R pane's blocks and status.json keys unchanged, no `hai-handoffs`, no `handoffs` key; an open one adds both, `v` 1. `/a5r handoff record` works with no adapter (`S-a: /a5r handoff record writes one file…`). Full suite 837 pass 0 fail. "tools list" read as the pane's tools list (F-a1) |
| A2 | met (S-b) | unit `S-b (A2): unit: declarations are validated on read …`, `S-b (A2, A17): unit: writeHosts is the one writer …` (hand edit → `edited-by-hand`), `S-b (A2): unit: levelOf derives the level from checks only, for every class of combination` (13 rows); engine `S-b (A2): engine: a hand edit … flagged edited-by-hand and must be re-checked`. Options are written to the machine-local file (F-b1) |
| A3 | met (S-b part: C1, C2, C4, C5, C10) | engine (mocked adapter): `S-b (A3): engine: C1, C2, C4, C5, C10 pass …`, `… C2 fails on the "b a c" -> "???" stdin case with its fix text verbatim …`, `… C1 fails with its fix line; C4 fails past 120 s; C5 fails on a rising count; C10 fails unread`, `S-b (A3, A13): engine: dependency skips …`. Live: C1, C4, C5, C10 pass; C2 failed under rev 2 (F-b4), passes under rev 3 (`C2 pass · sort a b c; 256 bytes in, same hash; stdout as sent`). C3, C6-C9, C11-C13: S-d |
| A4 | met (S-b part: ssh, manual, storm cap) | unit `S-b (A4): unit: the adapter contract on a fake transport …` (NO_ADAPTER_OP, ADAPTER_ERROR), `… ssh: the remote command is ONE argument string …` (timeout 30 s, exit 255 = LINK), `… ssh readFile caps at 1 MiB; writeFile …`, `S-b (A4, D16): unit: the backoff … 12 failures in 10 min …`; engine `S-b (A4, D16): engine: 12 link failures in 10 min pause the host with the refusal verbatim; resume lets it run again` (sticky 2 h later). herdr, command: S-d |
| A5 | open | S-c |
| A6 | open | S-c |
| A7 | open | S-d (S-a has the writer guard, D7 and D13 parts: unit tests `writer guard`, `D7`) |
| A8 | open | S-d |
| A9 | met (S-a parts: record, claim, acceptance) | unit `claimedBy …`, `claims: globs …`, `S-a (A9): unit: rule 1 …`; engine `S-a (D9): an edit inside another hand-off's exclusive claim is refused; inside a shared one it runs and is recorded …` and `S-a (A9): a PR whose diff holds a path … refused under rule 1; a reason line in findings.md lets it pass`: all pass in the 837-pass run |
| A10 | open | S-d |
| A11 | open | S-d, S-e (scenario 1 and 7's L0 record covered by the A1 test) |
| A12 | met (S-b part: tile, status.json `hosts`) | engine `S-b (A12): engine: the Hosts tile and status.json's hosts appear only with a host declared …; terminal and desktop alike` (absent with no host and no hand-off; `Object.keys(status)` = before + `hosts`, `v` 1; stale, link-storm); S-a (A1) still passes with the hand-off rows under the tile. Queue hint: S-c |
| A13 | met (S-b checks) | engine `S-b (A13): engine: /a5r host add runs C1, C2, C4, C5, C10 in order, stops at the first failure with its fix line; a second add resumes at it`; unit `planOf`; README section "Hosts" states each command and its output. C3 … C13 join in S-d |
| A14 | met (S-a) | new code in `claims.ts` (≈95 lines), `handoff.ts` (≈230), `handoffhost.ts` (≈180); register.ts 4148 -> 4136; `node dev/check-size.mjs`: `size check: passed`; `$` only in register.ts; `claude plugin validate --strict a5r`: `✔ Validation passed`; `node dev/test-all.mjs` fails only where the base fails (F-a6) |
| A15 | open | review below; release with the slice's PR |
| A16 | open | S-c, S-d |
| A17 | met | unit `S-b (A2, A17): …` (state keys refused in declarations; the file holds `v, hosts, sums` only); engine `S-b (A17): engine: two checkouts of one machine share one state and one link record under the coordination root; options hold declarations only`; hand edits of `Saved/A5R/hosts/` refused (engine `S-b (A13)` …) |

## Thermo-nuclear review

- Review 1 (S-a diff, subagent): Verdict: block. Critical: C1 claim-touch recorded before every refusal ran; C2 base ref normalized twice with a RegExp built from user input; C3 the three-tool test repeated and a growing ternary in register.ts; C4 duplicate status-row type, optional hook, hand-written ClaimTouch. Minors: result kinds twice, claim text twice, io shapes in acts.ts, `needs` cast, unknown op answered as S-d, nine advertised actions, status() double pass, origin id length, comment placement.
- Fixed in the S-a commit: C1 (record after the call ran), C2 (`baseRefOf` once in `fieldsOf`), C3 (`A5R_TOOL_ERRORS` table), C4 (`StatusHandoff`, required hook, `Omit<Recorded,…>`), and every minor.
- Review 2 (same reviewer, after the fixes): Verdict: pass. Three minors; fixed: `A5R_TOOL_ERRORS` is a Map (no inherited keys), `toolErrorText` indexes it without the dead fallback. Kept: literal tool names as the Map's keys (the constants live in register.ts and handoffhost.ts; tooldefs.ts holds the names as text, as EDITOR_TOOL_DEF does).
- S-b review 1 (subagent, S-b diff against 6532231): Verdict: block. Critical: isObj four times, `passed` twice, origin read copied; two parallel dispatchers; level and storm stored and recomputed (a storm lifted by itself, a hand pause undone by a storm on file); casts at the boundary (`options` unchecked, `args` spread); the hosts write rule in the hand-off module (and never called); two availability rules. Bugs: add dropped other fields, `originId` option ignored, the model could choose the local ssh program; minors.
- Fixed: shape.ts; one action table and one HostInput; `hostPhase` + `stormed` (sticky storm), `levelFor`; typed and validated reach options, `inputOf`; `hostsDesk.touch`, the `desk` alias gone; `availabilityOf`; add merges; `origin(io)` honours the option; the tool refuses `options.ssh`; hostbox.ts; probe catch; `roots` and the clock in ssh.ts removed.
- S-b review 2: Verdict: block. Critical: an ssh target starting with `-` (`-oProxyCommand=…`) or a model-written `options.config` could still run a local command. Minors: add dropped a label-only change, a cast in parseState, comment placement, a placeholder adapter, a silent catch, the write rule's reach.
- Fixed: target pattern and `--`; `PERSON_ONLY_OPTIONS` (ssh, config); add with no early return; parseState field by field; Seen built once; debug log; comments.
- S-b review 3: Verdict: pass. Two minors, fixed: `%` dropped from the target pattern; a hand-written entry naming the ssh client or config is not probed until `/a5r host add <id>`. Accepted: section 1b's link field names (documented), the link.jsonl race (F-b7).

Verdict: pass
