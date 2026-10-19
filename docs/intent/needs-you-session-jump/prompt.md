# Ather Automata: a decision opens in its own session

- Rev: 1
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
- A2: When another live session tracks the intent, the row offers "Go to session", which opens that session in the app (the app's window or session tool, called through `$.tool.call`); where that tool is not available (the terminal, the web), the row shows the session's title to switch to by hand and nothing is sent. Proof: e2e with the tool present and absent.
- A3: When another live session tracks the intent, Explain, the option buttons and Type an answer act in that session, never in the pane's own: the prompt is delivered to the tracking session (cross-session message through the session-management tool), the row says "Sent to <title>", and the pane's session starts no turn. When the pane's own session tracks the intent, or no session does, behaviour is as today (the pane's session), and an untracked intent's row says so. Proof: e2e (the pane's session gets no prompt when another session tracks the intent; the message carries the finding and the chosen option).
- A4: The Paseo port stays in step where it shares these modules (`npm run sync -- --check` in paseo/ather-automata); no regression: `S2_ROOT=<S2 checkout> node dev/test-all.mjs` back to back against origin/main (same failing set, plus the new tests passing), `claude plugin validate` and `claude plugin test`; version bump with a Changes line; a thermo-nuclear review per AGENTS.md with no open critical finding, recorded in progress.md and the PR. Proof: gate.
- A5: A PR to main, merged on Hai's go (Tin, 2026-10-07: "có thể PR và Merge luôn"). Proof: review.

## Constraints

- Work only in the worktree `D:/Projects/ather-mods-wt/needs-you`; never in the live checkout `D:/Projects/ather-mods`.
- Hooks never block or fail the calls they watch; pure rules without `$`; stored values only through `state.mjs` (Ather's conventions).

## Changelog

- rev 1 (2026-10-19): created from L-1.
