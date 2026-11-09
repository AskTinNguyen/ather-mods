# A5R hosts: Findings

Raised while building slice S-a (2026-11-09). None blocks S-a; each names what it changes and a proposal.

## F-a1: A1's "tools list output" is read as the pane's tools list

- What: A1 says the "tools list output" does not change with no hand-offs. The slice adds the model tool `mcp__a5r__host` (the brief and "Tools and commands" require it, and L0 `create` is its first action, so it cannot wait for a hand-off to exist). Read literally as "registered model tools", A1 and the brief conflict.
- Taken: "tools list" is the A5R pane's tools list (the tile row; README and the v2 tests use that name). The pane's blocks, the compact line and `status.json` are unchanged with no open hand-off (engine test `S-a (A1)`). The registered model tools are now editor, sync, host.
- Test change (no assertion removed): the three tests that list the registered tools now expect `['editor', 'sync', 'host']`: `a5r/tests/coord-engine.test.ts` (editor request), `a5r/tests/old-names.test.ts` (A48), `a5r/tests/rev40.test.ts` (A117).
- Proposal: say "the A5R pane's tools list" in A1 at the next rev.

## F-a2: the hand-off schema gains `by` (the session that recorded it)

- What: D9's own-claim exemption ("the hand-off's own session is not blocked by its own claim") needs to know that session; section 3 has no field for it.
- Taken: `by: { id8, lane }`, optional, written on create. Readers ignore unknown keys, so the schema stays `v: 1`.
- Proposal: add `by?` to section 3 at the next rev.

## F-a3: claim defaults are decided from the claim's own path

- What: F5 says binary assets default exclusive. A claim's `exclusive` is stored as a boolean (section 3), so the default is decided once, from the claim path: `Content/S2/A.uasset` or `Content/**/*.umap` default exclusive, a folder such as `Content/S2/Tail/` defaults shared even if it holds `.uasset` files.
- Effect: a folder of assets claimed without `!` lets another session edit its `.uasset` files (recorded, not refused).
- Proposal: keep it (explicit and predictable; `!Content/S2/Tail/` makes the folder exclusive), or decide per edited path when the claim gave no mark (needs a tri-state in the schema).
- Resolution (Hải, 2026-11-09): keep folder claims shared by default; `!` marks one exclusive.

## F-a4: no human command marks a hand-off merged

- What: the brief lists `/a5r handoff record|list|cancel|result`. Section 5 moves a hand-off to `merged` after the result is taken; in S-a only the tool's `update` with `state: "merged"` does it (refused until a result is recorded).
- Proposal: S-d adds result acceptance (A7), which moves it to `merged` after the result PR scores; a `/a5r handoff merged <id>` command can come with it.

## F-a5: what the claim check covers

- Edits through Edit, Write, MultiEdit and NotebookEdit in the shared checkout are checked (the same paths the touch files record). Shell commands that write a claimed path are not checked, and hand-written shell writes into `Saved/A5R/handoffs/` are not refused (the Edit/Write ones are). Acceptance applies claims to the S2 repository only, like other sessions' touch files.
- Proposal: extend to shell writes with the existing `writesInside` reader in a later slice if a lane needs it.

## F-a6: gate results that fail on the base too

- `node dev/test-all.mjs` stops at its unit stage on `FAIL reading a checkout (A1) > origin/main’s intents with their first and last commit dates…` (ather-board). The same test fails on the untouched base commit 586691c, run in a temporary worktree.
- The repos stage (`--only repos`) fails 54 tests on this branch and 54 on the base; the names differ by one pair of worktree-listing tests that alternate between runs (flaky). This branch changes nothing under `ather-automata/`, `ather-board/`, `ather-lanes/`, `paseo/` or `dev/`.

## F-b1: the plugin cannot keep `hosts` and `asHost` in its own options

- What: D2 puts the declarations in `pluginConfigs."a5r"`. The engine's `$.config.set` can change a plugin's own `userConfig` field, but a field holds only a boolean, number, string or list of strings (`ConfigValue`), and every change reloads the plugin with new options (the call that wrote it would answer from a plugin being replaced).
- Taken (per the brief): the declarations go to the machine-local `<home>/.claude/a5r/hosts.json` (outside any checkout, never in git), written only by `/a5r host …` and the host tool. They are read merged with the options `hosts`, `asHost`, `hostsOptions`, `originId` (declared in plugin.json as JSON text fields, written by hand); the file wins per host id. Each file entry carries the sum of what the tool last wrote; an option entry, or a file entry whose sum no longer matches, is `edited-by-hand`. A changed declaration drops the host to L0 until `/a5r host check <id>` (state.json keeps the sum the checks ran against).
- Proposal: say "`pluginConfigs."a5r"` or the machine-local hosts file" in D2 at the next rev.

## F-b2: the engine's stdin is text, so C2 (b) sends the 256 values as characters

- What: `$.process.run` takes `stdin` as a string. C2 (b) sends the 256 characters U+0000..U+00FF (UTF-8 on the wire: 384 bytes, every value 0x00-0x7F, 0x80-0xBF, 0xC2, 0xC3) to `git hash-object --stdin` on the host and here, and compares the hashes. Not every byte value is on the wire.
- Proposal: keep it until the engine takes bytes for stdin; then send the 256 raw bytes.

## F-b3: an S-a assertion changed (none removed)

- `a5r/tests/hosts-sa-engine.test.ts` (`S-a: the host tool: …`): `action: "status"` and `"add"` answered "not in this version → slice S-b adds hosts". S-b answers them, so the test now expects the status text (`This machine: L0.`) and add's id refusal, and adds `suggest` (still a later slice's: `A5R · host — not in this version → slice S-c adds suggest`).

## F-b4: C2 (a) as written fails on every clean Windows host (MEASURED, live smoke)

- What: C2 (a) sends the 6 bytes `b\na\nc\n` (LF only) to the remote `sort`. Windows `sort.exe` reads 6 bytes with no CR as 3 UTF-16 characters and prints `???`, with no shell in between:
  - on this machine, `C:/Windows/System32/sort.exe < (printf 'b\na\nc\n')` printed `???\r\n`;
  - on the second machine (no `HKLM\SOFTWARE\OpenSSH\DefaultShell` value: the default shell is cmd, and C1 read `windows (cmd)`), the same 6 bytes over ssh printed `???`, while `b\r\na\r\nc\r\n` printed `a b c`, the same 6 bytes hashed equal with `git hash-object --stdin` on both sides, and C2 (b) and (c) passed.
- So the link is byte-clean and C2 (a) still fails; the code does exactly what prompt.md and the brief say, and the live smoke reports C2 FAILED because of it. The 09/11 S2 reading (`b a c` came out `???`) may have been this sort artifact, not (or not only) the PowerShell default shell.
- Proposal: for a Windows remote, C2 (a) sends `b\r\na\r\nc\r\n` (the line ending Windows `sort` reads), POSIX keeps `b\na\nc\n`; C2 (b) (the hash of the same bytes on both sides) stays the byte-cleanness proof, and the fail text keeps the default-shell cause for (b) and (c). Not changed in S-b (the brief: no redesign); needs Hải's go.
- Resolution (t6, 2026-11-09, engineering call): proposal taken. C2 (a) sends `b\r\na\r\nc\r\n` to a Windows remote and `b\na\nc\n` to POSIX (`SORT_INPUT` in `a5r/hooks/hostchecks.ts`); C2 (b), the hash of the 256 values on both sides, stays the byte-clean proof; the fail texts and C2's fix line name the default shell as a possible cause (e.g. a PowerShell default shell), not a certain one. prompt.md rev 3 changes the C2 row and corrects Sources S2 (the `???` reading was this artifact; what was measured is the multiplexer failing while `DefaultShell = powershell.exe` was set and working right after it was removed, one before/after, mechanism not proven). Live: `C1 pass · windows (cmd), 1547 ms`, `C2 pass · sort a b c; 256 bytes in, same hash; stdout as sent`.

## F-b5: what S-b cannot know on the origin side

- `asHost.availability.windows` of a remote host are on its card (S-c), so `levelOf`'s "C4 when windows are used" is never active for a remote in S-b.
- C10's "one coordination root per machine" can only be read for the remote from its card (S-c); S-b's C10 reads RAM only (A16 checks the roots in S-c or S-d).
- A `manual` host never reaches L1 (C2 and C5 need a link: `skip`), as D1 and D15 say.
- C5 on Windows (`tasklist /fi "USERNAME eq %USERNAME%"`, 3 cycles) took about 100 s on the second machine (MEASURED, one run): slow, not wrong.

## F-b6: the card probe runs only in the status.json writer

- D2/D20 name one writer per file. The probe card is written by the session that writes `status.json` (the first live one in the queue order), in the background, so a dead host never holds the minute tick; it skips a paused or storming host and waits the backoff after a failed probe (D16).

## F-b7: link.jsonl has no append, so two writers at once can drop a line

- The engine's file API has no append. A link line is written by reading `link.jsonl` again just before the write (the window is one read and one write). Two sessions failing the same link in the same instant can still lose one line, which only delays the storm cap by one failure.
- Proposal: use an append when the engine offers one; until then, keep it (the storm, once seen, is kept in state.json and holds until a resume).

## F-b8: the local ssh client is the person's choice

- Review 1 found that the model's host tool could pick the local program the ssh adapter runs (`options.ssh`, `options.args`). Now `reach.options` takes only `ssh`, `config`, `laneRoot`, `a5rRoot` and `reverse`; `ssh` must be an `ssh`/`ssh.exe` path; and the tool refuses `options.ssh` (`A5R · host — the local ssh client is the person's choice → /a5r host add <id> --reach ssh:<target> --ssh <client>`).

## F-c1: the card carries `roles` (and `acceptsFrom`)

- What: D2 says a host's roles are read from its card, and the S-c brief's `NO_ROLE` matches a request's `wants` against "card roles", but section 2's card had no roles field. The brief adds `acceptsFrom`; `roles` was needed the same way.
- Taken: `roles?: string[]` on the card (an A5R card: `asHost.roles`; a probe card: the declaration's `assumed.roles`, absent without them). Both are optional, so the schema stays `v: 1`. prompt.md rev 4 adds both to section 2.

## F-c2: an A5R host's card needs a heartbeat to stay fresh

- What: decision 1 writes `card.json` "only when content changed, like status.json". A quiet host's card would then keep its old `at`, read as `STALE_CARD` on every origin after `staleCardMin`, and a live host would never be suggested.
- Taken: written on a change, or when the last write is older than half of `staleCardMin` (5 min by default) with no change. prompt.md rev 4 says so under section 2.

## F-c3: an S-a assertion changed again (none removed)

- `a5r/tests/hosts-sa-engine.test.ts` (`S-a: the host tool: …`): `action: "suggest"` answered `A5R · host — not in this version → slice S-c adds suggest`; S-c answers it, so the test now expects `{ suggestion: "none", whyNot: [] }` (no host declared).
- `a5r/tests/hosts-sb-engine.test.ts` (`S-b (A2): engine: a hand edit …`): a label renamed by hand expected `L0 · … · declaration changed since the checks`. Under F-c4's resolution a label keeps the level, so the test now expects `L1 · … · edited-by-hand` for the label, then changes `reach.options` by hand and expects the old `L0 · … · declaration changed since the checks` line (the assertion's intent kept). The S-b desks also get the new `local` closure (a fixed quiet machine).
- `a5r/tests/rev40.test.ts` (`A117: person-only: …`): the editor tool's input names now include `needGb`, `readOnly` and `wants` (suggest's inputs, additive); the test's other checks (no order or resize field) are unchanged.

## F-c4: `/a5r host set <id>` (label, owner, assumed) drops the host to L0 (S-b behaviour, not changed)

- What: `set` answers `A5R · host <id> changed (no check needed).`, but the stored checks ran against the old declaration's sum, so `levelOf` reads the host as L0 until `/a5r host check <id>` (the S-b rule "a changed declaration is re-checked"). Seen in the S-c engine test (`UNCHECKED` next to `UNAVAILABLE` after `assumed.availability` changed).
- Proposal: for fields that need no check (label, owner, assumed), keep `declSum` in step (or sum only reach, repo and engine), so `set` and the level agree.
- Resolution (t6, 2026-11-09, in S-c): the sum that gates the level (`checkedSumOf` in `a5r/hooks/hosts.ts`, state.json `declSum`) covers only reach, repo and engine; label, owner and assumed change without dropping the level. The edited-by-hand sum still covers the whole entry. Test: `S-c (F-c4): engine: set label, owner or assumed keeps the level; a reach changed by hand drops it …`. A state.json written before this keeps a whole-entry sum and reads as changed once: `/a5r host check <id>` again.

## F-c5: what S-c measures and what it leaves

- An A5R host's `machine.totalRamGb` is null: the shared probe (`Saved/A5R/probe.json`) reads free RAM and disk only. `machine.engine` is not filled (no engine version string is known to a5r). Both are allowed by section 2 ("null when unreadable").
- `NO_RAM` is said when the host's free RAM is unread (a probe card that could not read it), with the note `RAM unknown`: a suggestion never rests on a guess.
- The hint is left out for a session that holds the Editor (its file's `holding`; a granted request needs no other machine), in the reply, the status and the rows alike. In `status` it is the JSON field `fits`; in the request's reply one more line.
- A host whose link is paused or storming (D16) counts as `UNAVAILABLE` while its stored card is still fresh.
- `READONLY_WAIT` reads the request's live wait (A125, `liveWaitMin`), as the rest of a5r does.
- The origin reads a host's A5R card every minute when it declares `reach.options.a5rRoot` (on Windows two short ssh calls: the size, then the file); it writes its copy only when it changed. Without `a5rRoot` the probe card is refreshed only when stale, as in S-b.

## F-d1: the engine has no detached start, so `asHost.startCommand` must return at once

- What: decision 2 says the host tick starts an accepted job "once, detached". The engine's `$.process.run` waits for the command to exit (30 s here) and `$.process.spawn` ends the child with the loop or the module, so a5r cannot leave a process running by itself.
- Taken: the tick runs `startCommand` once through `$.process.run` in the coordination root (30 s), records `startedBy: "startCommand"` and the start's result in `progress` whatever it said (a failing command is not run every minute). The command must detach itself, e.g. `hc run --bg --outlive-parent …` (README says so).
- Proposal: keep it; a detached start in the engine would let a5r start a plain command.

## F-d2: assertions changed by S-d part 1 (none removed)

- `a5r/tests/hosts-sa-engine.test.ts` (`S-a: the host tool: …`): `op: "packet"` answered `A5R · host — not in this version → slice S-d adds the hand-off packet`; S-d answers it, so the test expects `A5R · handoff — packet is for a hand-off to a declared host → <HANDOFF_USAGE>` (an L0 record has no packet).
- `a5r/tests/hosts-sb-engine.test.ts`: `planOf` now goes on to C13 (`['C2', 'C4', 'C5', 'C10', 'C13']`, a new row for "L1's checks passed: it resumes at C13"); `host add` reports `6 checks run` with a `C13 …` line (skip without a card, or `not run: C2 failed`); the second add `5 checks run` ending with `C13 skip · no card read yet`; the options list in the unknown-option problem names `hc, deliverTo, ops, os`; the L1 status's next step names the inbox adapters instead of "not in this version (slice S-d)".
- `a5r/tests/hosts-sc-engine.test.ts` (`S-c (A12, A16)`): `6 checks run; level L1.` (C13 joins the run).
- The S-b and S-c desk fixtures gained the new closures (`alive`, `start`, `sleep`), as S-c did with `local`.

## F-d3: C12 runs only when named

- What: C12 waits for the host's minute to answer (up to 150 s). Run inside `host add` (A13's C1-C13 in order), every add of an L2 host would block the tool call for up to 2.5 min, and the engine tests' simulated clock never fires the wait.
- Taken: the resume plan (`AUTO` in `a5r/hooks/hostchecks.ts`) is every built check except C12; `/a5r host check <id> C12` runs it (and its result counts for L2). README says so.
- Proposal: keep it, or make C12 two-phase (send now, read the answer at the next `check`).

## F-d4: no compact line for a hand-off that needs a person (part 1)

- What: decision 4 asks for one compact line on `declined`, `failed`, `returned`, `lost`, `preempt`. The compact line's parts are drawn in `register.ts`, which is over 1,000 lines and may not grow.
- Taken in part 1: the notice goes to the session that created the hand-off once per transition, as an actionable notice (it wakes an idle session; `done` is not actionable), and the Hosts tile shows the effective state with its flag.
- Proposal: part 2 moves the compact line's part list into a module of its own (so register.ts shrinks) and adds the hand-off part there; or Hải accepts notice + tile as enough.

## F-d5: the hand-off's PR is scored by the existing scorer, called directly

- What: decision 6 says the after-the-fact scorer scores the result PR "the way it scores an intent's `- PR:` line". That loop (`postHoc` in register.ts) reads only the tracked intent's PR lines and only at the end of its checklist, and writes the card's acceptance section.
- Taken: the origin's minute calls the same per-PR scorer (`scorePr`, which also reads the PR's GitHub state) through the desk's io, at most once per 10 min per hand-off; `/a5r pass <hand-off id>` (passKey now takes a hand-off id) or `/a5r pass #<PR>` lets a failing score merge. The score is not shown in the acceptance card's section; its failing rules show on the hand-off's row.

## F-d6: A16 in part 1, what was already there and what was added

- Already there (read in `a5r/hooks/register.ts` `findCheckout` and `a5r/hooks/machine.ts`): a session in a lane that is a git worktree of the coordination root finds the main tree, so its Editor holder, queue, RAM gate and sync freeze are already the coordination root's (D19). The card's queue part came in S-c.
- Added: a session whose own tree lies under `asHost.laneRoot` (a separate clone too) coordinates through `asHost.coordinationRoot` (`coordinationFor` in `a5r/hooks/hosts.ts`, read from the machine-local hosts file; the plugin option's `asHost` is not read there, because `findCheckout` runs before the options are parsed). NO_EDITOR_PROTOCOL at create (decision 7). A job's Editor request is an ordinary request in that queue, so "two Editors on one machine never run at once" is the existing lock.
- Left for part 2: C10's "two declared coordination roots fail" (one machine-local hosts file holds one `asHost`; only an option `asHost` in another checkout could differ).
