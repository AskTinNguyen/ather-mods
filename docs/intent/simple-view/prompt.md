# Ather Automata: Simple and Advanced views of Home

- Rev: 1
- Status: completed
- Area: ather-automata
- Owner: Tin Nguyen
- Skill: `plugin-authoring`
- Branch: `ccr-c3eb09ca-i9bahh`
- Started: 2026-10-18

## Goal

Ather's Home has grown: the stage track, a role and proof line, a summary strip, quick actions, workers, previews of your own and your teammates' work, Heading off? and Stepping out?, around the two things most people open it for: what needs them, and what to do next. Some of the team find it too much. Give Home a Simple view with only those, keep today's Home as the Advanced view, and let each person switch with one press and keep their choice.

## Non-Goals

- Changing what Advanced shows. Advanced is today's Home, and the default, so no one's pane changes on update.
- Changing the other pane modes (Everything open, an intent's view, Away, Skills, Create), the band above the prompt, pop-ups or commands. What Simple leaves out stays a command away (`/ather pick`, `/away`, `/warm`, `/ather intent`).
- A setting in `userConfig`, or a team-wide default. The choice is each person's, made in the pane.
- The Paseo panel (it lags the mod: README Limits). The shared modules are synced, so the panel can follow later.

## Sources

- Tin (2026-10-18): "some of our team members may not want to see all the bells and whistles and be overloaded and overwhelmed with information."
- The Fable design reviews of the Ather UI Mockups (2026-10-18): status was repeated 4–6 times per screen; the pane's restraint is the level to aim for.
- The code at origin/main eae8432: Group by in Everything open is the pattern for a remembered per-person choice (`KEY.groupBy`, `readGroupBy`/`setGroupBy`, read once a session, a press beating a late read).

## Decisions

- D1 (views): two, Advanced and Simple. Anything stored that is not `simple` reads as Advanced.
- D2 (what Simple shows): the title, its status line (stage, progress, the sync line), Needs you, Needs attention, Next, and the toggle. It leaves out the stage track, the meta line (role, proof, the Editor lock, the week), the summary strip, the quick actions, workers, the previews of your and your teammates' work, Heading off? and Stepping out?.
- D3 (remembered): per person in the store (`view:<person>`), through `state.mjs`, read once a session as Group is; a press made before the read lands is not undone by it.
- D4 (toggle): a quiet button at the foot of Home, `v` in the terminal ("Simple view" / "Advanced view"), a plain button on the desktop; `/ather simple` and `/ather advanced` do the same and say how to go back.
- D5 (one table): `home.mjs` holds the one list of what Simple leaves out (`isShownIn`); `console.mjs` names Home's parts and draws those the view shows, with no check per part.

## Acceptance

| Id | Item | Proof |
| --- | --- | --- |
| A1 | `isShownIn` and `paneViewOf`: Advanced shows every part; Simple the D2 set; anything but `simple` is Advanced. | Unit. |
| A2 | Simple Home draws the title, status, Needs you, Needs attention and Next, and none of the D2 parts it leaves out. | repos e2e (terminal). |
| A3 | Advanced Home is unchanged: every existing e2e passes; the only addition is the toggle at its foot. | `node dev/test-all.mjs`; repos e2e. |
| A4 | The choice is kept per person and a new session opens in it. | Unit (store); repos e2e (a second session on the same store). |
| A5 | `/ather simple` and `/ather advanced` switch and say how to go back. | repos e2e. |
| A6 | Every key on Home is drawn once in both views; the desktop draws the toggle without a key. | repos e2e. |
| A7 | Gates: `node dev/test-all.mjs` green, Paseo and board copies in step, `claude plugin validate ather-automata` and `claude plugin test ather-automata` pass; 0.4.0 with a Changes line. | The runs. |
| A8 | Thermo-nuclear review PASS on the branch's diff against main. | progress.md and the PR. |

## Changelog

- rev 1 (2026-10-18): created.
