# Ather Automata for Paseo: the Simple view and the branch check in the panel

- Rev: 1
- Status: completed
- Area: paseo
- Owner: Tin Nguyen
- Skill: `plugin-authoring`
- Branch: `ccr-c3eb09ca-i9bahh`
- Started: 2026-10-18

## Goal

The Paseo panel has lagged the mod since 0.4.0: no Simple view, no check of the agent's branch against origin's base, no merge line, and a composer pill that says only "title · stage". Bring it up to 0.6.0 with the shared code, not a second copy of the logic.

## Non-Goals

- The rest of the Paseo Limits (newcomer tour toast, Send where?, prompt cache): unchanged.
- Rendering the panel here: it is React Native inside the Paseo app, which this environment does not have. The server side is run on real git; the panel's drawing is type-checked. Looking at it in Paseo is owed to the owner.
- Whether the team uses Paseo daily. The Fable review made parity conditional on that, which only the owner knows. Done anyway, since the cost was small once the check was shared code (D1).

## Sources

- The Fable review of the proposal: "Paseo parity: Simple view and collision alert in the Paseo panel".
- simple-view, collision-alert and ship-pill (completed).

## Decisions

- D1 (one check): `checkBranch` and `isSameCheck` move into `collide.mjs`; console.mjs and the Paseo server both call them, each with its own `overlapJob`. Home's parts (`HOME_PARTS`) and the views' replies (`viewText`) are shared too.
- D2 (Simple view): the server sends `shows` (the parts the person's view shows) and `viewToggle`; the panel draws each section only where `shows` names it (stages; status; meta for proof, role and holder; merge; strip; crew; preview for today's lines and Work; actions for Start; away; view for the toggle). `/ather simple`, `/ather advanced` and an act `pane` (the toggle) set it through `state.mjs`, as in the mod.
- D3 (branch check): run as each checkout's model is built; a new answer makes every agent's view stale. `buildHome` gets `merge`, so Needs you, the merge line (`merge`) and the composer pill (`header.pill`) come from the same shared code.
- D4 (proof): `dev/e2e/paseo.mts` runs the Paseo server (`homeView`, `act`, `runCommand`, `bandOf`) over a real checkout; `dev/test-all.mjs` runs it where paseo's npm install is in place.

## Acceptance

| Id | Item | Proof |
| --- | --- | --- |
| A1 | Needs you has the collision after the fetch; the merge line warns; the composer pill says something needs you. | `proof/paseo-report.md` (dev/e2e/paseo.mts). |
| A2 | `/ather simple` leaves the Simple parts; the toggle brings every part back; kept per person. | Same. |
| A3 | Once main is merged in: merges cleanly, the item gone, the pill is the tracked intent's stage. | Same. |
| A4 | The mod is unchanged (0.6.1, shared code only); every gate green; the panel type-checks. | `node dev/test-all.mjs`. |
| A5 | Thermo-nuclear review PASS. | progress.md and the PR. |

## Changelog

- rev 1 (2026-10-18): created.
