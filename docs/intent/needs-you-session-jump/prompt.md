# Ather Automata: a decision opens in its own session

- Rev: 3
- Status: active
- Area: ather-automata
- Owner: HaiHuynh
- Skill: `plugin-authoring`
- Branch: `intent/needs-you-session-jump`
- Started: 2026-10-19

## Goal

A Needs you decision is answered in the session that works on its intent, and the pane says which session that is. Today a row such as "Decide F-1 on kawaii-physics-toolset" shows no session; pressing Explain or Type an answer hands the prompt to the session the pane is open in, which may be an unrelated thread (Hai, 2026-10-19, screenshot from the "S2 sync main" session: "Nhìn phía Need Decision tôi không biết là ở Session nào … Còn nếu tôi bấm vào luôn thì có khả năng nó mở chat ngay trong session tôi đang xem, aka sai thread, gây noise context").

## Non-Goals

- Changing how decisions are parsed, counted or recorded (decide-in-place's rules stay).
- Deciding anything without the person's press.
- Opening or creating a session that does not exist: a decision no live session tracks keeps today's behaviour, labelled.

## Acceptance

- A1: Each Needs you decision row (single decisions and the "▸ <intent> · N decisions" group) names where its intent is worked on: the title of the live session that tracks the intent (Ather's lanes), "this session" when it is the pane's own, or "no session tracks it". The session's title is the app's session title (the session records its own app session id and title in its lane, e.g. through the session-management tool's `get_session` for "self"), never a raw CLI id. Proof: unit tests on the row model; e2e: another lane tracking the intent shows its title on the row.
- A2: Where a decision row names another session, it offers that session's own app link (the `link` the app gives for a session in `get_session` / `list_sessions`, e.g. `claude://claude.ai/epitaxy/local_…`) as a Link element "Go to session ›", which opens it from any session; the window tool (`open_session_in`) is used only where it applies (a session this one started). With no link (the terminal, the web), the row shows the session's title to switch to by hand. Proof: unit test (the row carries the link); e2e with and without a link; review: a press in the desktop app opens the session (Hai).
- A3b: An intent no live session tracks gets a best guess, labelled as one: the most recently active open session whose transcript mentions the intent's folder name (the app's `search_session_transcripts`, at most once per intent per 10 minutes), shown as `probably in "<title>"` with its Go to session link; presses on an untracked intent still go to the pane's own session unless the person presses Go to session. No match: `no session tracks it` as before. Proof: unit test on the pick; e2e with the tool answering and absent.
- A3: When another live session tracks the intent, Explain, the option buttons and Type an answer act in that session, never in the pane's own: the prompt is delivered to the tracking session (cross-session message through the session-management tool), the row says "Sent to <title>", and the pane's session starts no turn. When the pane's own session tracks the intent, or no session does, behaviour is as today (the pane's session), and an untracked intent's row says so. Proof: e2e (the pane's session gets no prompt when another session tracks the intent; the message carries the finding and the chosen option).
- A4: The Paseo port stays in step where it shares these modules (`npm run sync -- --check` in paseo/ather-automata); no regression: `S2_ROOT=<S2 checkout> node dev/test-all.mjs` back to back against origin/main (same failing set, plus the new tests passing), `claude plugin validate` and `claude plugin test`; version bump with a Changes line; a thermo-nuclear review per AGENTS.md with no open critical finding, recorded in progress.md and the PR. Proof: gate.
- A5: A PR to main, merged on Hai's go (Tin, 2026-10-07: "có thể PR và Merge luôn"). Proof: review.
- A6 (rev 3): **Go to session** opens the session when pressed on the desktop. MEASURED by Hai (2026-10-26, screenshot): pressing "Go to session ›" on a Needs you row does nothing. It is a `Link` with the app's `claude://` session link (rows.mjs:261). The engine says a Link is "an anchor on desktop" and "what a click opens is the surface's". INFERRED: the desktop pane's anchor does not open a `claude://` URL. Fix: make it a Button whose press asks the operating system to open the app's session link (`cmd /c start "" <link>` on Windows, `open` on macOS, `xdg-open` elsewhere), sharing Ather Board's system opener rather than copying it. Keep the Link only on the terminal, where the terminal opens it. When the opener fails, the row says so and names the session to open from the sidebar. Proof: unit test (a Button on desktop, the Link on the terminal); e2e (the press runs the opener with the link, and a failure is said); review: a press in the desktop app opens the session (Hai).
- A7 (rev 3): A best guess is a real guess. MEASURED (same screenshot): three different intents were all labelled `probably in "Build typed Breakable conversion…"`, because the transcript search returns any session that merely mentions an intent's folder name, and a session that reads many intents matches them all. A session that matches 3 or more of the open intents with a decision is not taken as the guess for any of them. A hit whose title or snippet shows it works on the intent (the title carries the intent's name as whole words, or the snippet shows its branch `intent/<slug>`, its folder `docs/intent/<slug>/`, or its prompt.md, progress.md, log.md or findings.md) is preferred over a plain mention. With no such hit the row says `no session tracks it`. Proof: unit test on the pick (a session matching many intents is dropped; a title match wins).

## Constraints

- Work only in the worktree `D:/Projects/ather-mods-wt/needs-you`; never in the live checkout `D:/Projects/ather-mods`.
- Hooks never block or fail the calls they watch; pure rules without `$`; stored values only through `state.mjs` (Ather's conventions).

## Changelog

- rev 1 (2026-10-19): created from L-1.
- rev 3 (2026-10-26): L-2 (Hai: Go to session does not work): A6 a Button that opens the session through the system opener, A7 a best guess that is not every intent's.
- rev 3 (2026-10-26, after Fable's review of a7beeaa): A7 reads "title or snippet": the app's search reply has no branch field (`sessionId`, `title`, `cwd`, `isArchived`, `lastActivityAt`, `snippet`), so the branch is read from the snippet text; title words match whole words only.
- rev 2 (2026-10-19): F-1 → A2 uses the session's app link; F-2 → A3b a labelled best guess for untracked intents from the app's transcript search.
