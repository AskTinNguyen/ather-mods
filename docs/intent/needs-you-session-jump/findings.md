# needs-you-session-jump: Findings

Discoveries that may change the intent. The worker adds entries; the orchestrator resolves them.

## F-1 (2026-10-19, rev 1) | blocking: no | status: open (director)

**Found:** The desktop app's `mcp__ccd_window__open_session_in` (its schema, read in this session) shows only "self" or a session this session started: "for any other session, ask the user to open it from the sidebar". A decision's tracking session is another person-started session, so in practice the app will decline **Go to session ›**, and the pane then says to open the session by its title from the sidebar (A2's fallback). The same app's `get_session` returns a `link` that "opens the session in this app from outside it", and the engine draws a `Link` element on every surface (an anchor on desktop).
**Proposed amendment:** each session also records its `link` in its lane, and **Go to session** becomes a `Link` to it where the lane has one (the tool press stays for "self"-started sessions, or is dropped). Not built: A2 names the window or session tool through `$.tool.call`.

## F-2 (2026-10-19, rev 1) | blocking: no | status: open (director)

**Found:** In the S2 checkout on this machine (read 2026-10-19 ~11:35), no live lane names kawaii-physics-toolset or tower-stair-pcg; the only lane naming one of the screenshot's intents is an ended one from 2026-10-12 (ngao-binh-head-detachment). So for the screenshot's rows 0.6.2 says "no session tracks it", and a press goes to the pane's own session as before, now labelled. A session tracks an intent only after `/ather intent`, Work on this here, or its main thread writing that intent's prompt.md or log.md; a worker or session that only edits progress.md or findings.md does not.
**Proposed amendment:** the director decides whether the sessions working on those intents should track them (the intent skill's worker brief could start with `/ather intent <slug>`), or whether an edit to progress.md by a session's main thread should track the intent too.

## F-3 (2026-10-19, rev 1) | blocking: no | status: open (director)

**Found:** On origin/main 9ec10ea, with this account's default TEMP (the 8.3 name `C:/Users/HAI~1.HUY/...`), `S2_ROOT=E:/Projects/s2 node dev/test-all.mjs` stops at the ather-board unit stage (72/73: "reading a checkout (A1) > origin/main's intents with their first and last commit dates…", expected [true,40,2], got [false,0,2]; this is the "one e2e failure" the brief named), so the e2e stages never run, and run one by one 55 repos e2e checks fail too, against `C:/Users/hai.huynh/...` real paths. With TEMP and TMP set to the long path, the base passes the board unit (73/73) and repos e2e (286/286); only the S2 e2e's 12 S2-data checks fail. Not caused by this change.
**Proposed amendment:** none for this intent; run the gates with a long-path TEMP here, and the short-name paths are worth their own fix.
