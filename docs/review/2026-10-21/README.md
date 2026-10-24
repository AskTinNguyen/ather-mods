# Architecture review, 2026-10-21

A review of the whole repository at `999a2ba` (after #83): architecture, features, code quality, UI/UX and the way people and agents contribute. Ten reviewers each covered one area. An adversarial verifier then checked each area's findings against the code. The four proposals below were each drafted, critiqued and revised.

| File | What it proposes |
| --- | --- |
| [uiux.md](uiux.md) | 30 UI/UX changes in five themes, with before/after sketches and which ones become intents |
| [refactor.md](refactor.md) | The target architecture and a phased clean-up plan (safety net, now, next, later), with lanes so parallel PRs do not collide |
| [automation.md](automation.md) | Repo skills, CI, PR guards, a weekly job and three cloud routines, with a rollout order and three owner decisions |
| [findings.md](findings.md) | All 124 verified findings, by area |
| [drawn/](drawn/) | Home, Away, decisions and the band as the pane draws them at 72 and 110 columns, with the stand-in engine |

The drafts these proposals describe are on this branch: `AGENTS.md`, `.agents/skills/{gates,pr,shared-change,release,intent}`, `.claude/skills/` (copies), `dev/{check-release,check-size,skills}.mjs`, `.github/workflows/` and `.github/pull_request_template.md`.

## What matters most

1. **Main is red, and nothing would say so.** There is no CI and `main` is unprotected. The repos e2e fails on macOS: "the row says where it went" and "the row says Sent to that session" (`dev/e2e/repos.mjs:1442`, `:1518`). It fails because every session in a run shares one hooks module [tests-4]. `test-all` stops at that stage, so the board e2e never runs. The Paseo type-check has been red since 10-19 (`paseo/ather-automata/server/needs.ts:57`) [paseo-2].
2. **Names are mangled for most of the team.** `tidyName` keeps ASCII letters only: "Hoàng Vũ" is drawn as "Ho Ng V", and "HUYNH DONG HAI" as "Huynh" (`ather-automata/hooks/worklist.mjs:188`) [ux-pane-4].
3. **The away flow can say the wrong rule and start by accident.** In web repos, `/away` says "nothing merges" when `with-proof` lets the session merge. Opening ☾ focuses "Until done", so one Enter starts 24-hour windows in every ticked session [ux-pane-2, ux-pane-m1].
4. **`console.mjs` is 2,296 lines and grows about 60 lines a day.** It appears in 35 of 71 merged PRs. The 1,000-line rule only fires when a file crosses 1,000, so it never fires here [console-1, process-6].
5. **The same logic is written twice.** 12,870 committed lines are copies, made by three scripts, each in its own way. Paseo rewrites the controller layer (about 1,700 lines, typed `any`) and lags 0.6.2-0.6.6 [arch-1, arch-4, paseo-3].
6. **Versions are bumped in feature branches.** So parallel PRs collide (#78 shipped 0.6.5 before #82 shipped 0.6.4). The release files are the busiest files in the repo [process-1, arch-9].
7. **The weekly report can leak.** It pushes full prompts, folders and excluded sessions to the reports repo, behind regex redaction [calendar-1].

## Order of work

1. **Green and guarded** (days): fix the e2e session sharing and `needs.ts:57`; land `ci.yml` and `pr-rules.yml`; protect `main`, and require branches to be up to date before merging.
2. **Trust fixes** (small PRs): names (U1), the away rule and focus (U2, U3), Next with a blocking decision (U4), Needs you past nine items (U5), the board publishing drafts as main (U8), the calendar report's redaction (calendar-1).
3. **Skills and AGENTS.md:** land this branch's skills and AGENTS.md, then run `/intent init` to write `docs/intent/README.md`.
4. **Structure** (refactor.md, phases 1-2): one share script, versions picked at release time, shared pure flows for Paseo, then `console.mjs` split along its section seams.

## Owner decisions (2026-10-21)

- **ather-board does not release when only its copies move.** They ship with its next real release. check-release notes it and never fails on it.
- **A file over 1,000 lines may not grow.** `check-size.mjs` fails on it in CI, and the `pr` skill counts it as critical. Only the owner's `size-accepted` label lets a PR through. This blocks new code in `console.mjs` until it moves into modules of its own, which makes the `console.mjs` split (refactor.md P2.1) urgent.
- **A release PR that only moves version numbers needs no thermo-nuclear review.** AGENTS.md says so.
- **The team uses both dark and light themes.** The pane's colours follow each person's theme (uiux.md U31), and visual changes are checked in both.

Still open: what support level does Paseo get, parity or a written list of what it lacks?

## Thermo-nuclear review of this branch's drafts

The first round blocked on five critical findings, all duplication: the verdict check written inline in YAML (C1), the type-check copied into `weekly.yml` (C2), test-all's Paseo stage rebuilt in `ci.yml` (C3), the two branch checks repeating their setup and disagreeing on what ships (C4), and a third copy of the sync mechanism (C5). Each is fixed on this branch (automation.md, "Changed after the drafts' own thermo-nuclear review"). The PR records the rounds.

## What was not checked

The real desktop app, a light theme, an S2 checkout (no `S2_ROOT`, so the S2 e2e and S2 pack Home were not run), the Paseo panel on a real host, and the workflows on GitHub's runners. Every workflow `run:` step was run locally against a scratch clone.
