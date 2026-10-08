# Ather Automata avatar frame

- Rev: 1
- Status: closed
- Area: ather-automata
- Owner: HaiHuynh
- Skill: `plugin-authoring`
- Branch: `intent/avatar-frame`
- Started: 2026-10-07

## Goal

A worker's avatar in the pane is a round badge with nothing around it, in the light theme and in the dark one. Today a running worker's avatar shows inside a white square (screenshot, desktop, dark theme): the avatar is drawn as an `isInteractive` Svg (for its bob animation), and the engine draws such an Svg in a sandboxed frame that paints an opaque page when the frame's colour scheme differs from the app's; `avatarSvg` (`ather-automata/hooks/squad.mjs:136-148`) already sets `color-scheme: light dark; background: transparent` on the svg root, which is not enough.

## Non-Goals

- Changing the avatars' art, kinds, props or state colours.
- a5's red scarf (that is the a5 mod's, on top of this).

## Acceptance

- A1: A running worker's avatar shows no square in either theme: either a frame that is transparent in both (proved on the real desktop pane in light and dark), or, where that cannot be made sure, the running avatar drawn as a still image (no `isInteractive`) with its "running" state kept by the ring colour; finished and idle avatars stay images. Proof: gate: unit tests on the avatar source and the element props; review by Hai on the real pane in light and dark.
- A2: The finished-worker trail icons (`propSvg`) and any other Svg Ather draws with `isInteractive` get the same treatment. Proof: gate: a test listing every Svg Ather draws with its `isInteractive` value and why.
- A3: No regression: unit tests, `S2_ROOT=<S2 checkout> node dev/test-all.mjs --layouts` against origin/main back to back (layouts identical except the avatar elements), `claude plugin test`, `claude plugin validate`; version bump, a Changes line. Proof: gate.
- A4: A PR to main; Hai may merge it (Tin, 2026-10-07: "có thể PR và Merge luôn"). Proof: review.

## Constraints

- Work only in the worktree `D:/Projects/ather-mods-wt/avatar-frame`; never in the live checkout `D:/Projects/ather-mods`.

## Changelog

- rev 1 (2026-10-07): created from L-1.
- closed (2026-10-08): A1–A4 met; Hai's review "yep" (no square in dark or light); merged as PR #9 at 0.1.7.
