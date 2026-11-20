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
