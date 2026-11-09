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
