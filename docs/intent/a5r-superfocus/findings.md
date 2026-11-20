# Findings: a5r-superfocus

## F-1 (open, for Hải): A5R cannot stop, archive or unarchive a session itself

The plugin engine has `$.session.send` and `$.prompt.submit`, but no call that stops, archives or unarchives a desktop
session. Super Focus therefore hands those steps to the conductor's model as one exact prompt (the desktop app's
`stop_session`, `archive_session`, `unarchive_session`, `send_message`), matched by title. Proposed: keep it so; if the
engine gains such calls, the prompt becomes direct calls.

## F-2 (open): the first live run must wait for a quiet machine

Super Focus stops and archives real sessions. Its first live run should happen with no sync planned within the next hour
(D2 refuses a cutoff or freeze, but not a sync planned 40 min ahead) and with Hải watching, before it is used unattended.

## F-3 (note): the S2 guard refuses `git worktree add` for any repository

`scripts/devdrive/guard-worktree-add.ps1` in S2 refuses every `git … worktree add`, also for this repository. This work
lives in a plain clone at `D:/Projects/ather-mods-wt/a5r-superfocus` instead (origin set to GitHub).

## F-4 (note): overlap with intent a5r

Intent `a5r` (rev 47, the umbrella of the mod) names `a5r/hooks/` and `a5r/tests/` too. This intent changes 11 files in
`a5r/hooks/` and 4 in `a5r/tests/` (listed in prompt.md, Paths); no other session works on intent a5r now (its last
commit, ad3ac22, is this branch's base). The overlap is the feature itself plus helper moves that keep register.ts from
growing; it lands as its own PR into `intent/a5r`, and intent a5r's next rev should name Super Focus in its list.

## F-5 (open, for Hải): Ather's core pack does not read `claude plugin test` as tests

A5R acceptance rule 2 asks for Ather's test proof. This checkout's Ather pack is `core` with no gates, and it reads no
pass count from `claude plugin test a5r` (831 pass, 0 fail, run in the foreground at 18:4x and read back in full), so
the proof stays `none`. Running some other test command only to satisfy it would prove nothing about this change.
Proposed: Hải lets this PR through once (`/a5r pass a5r-superfocus`), and the `claude plugin test` summary
(` N pass` / ` N fail`) becomes a gate Ather's packs read, in its own PR to ather-automata.
