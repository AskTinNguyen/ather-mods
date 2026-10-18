# collision-alert: Log

## 2026-10-18

- Created after pane-modes. The proposal had "shared collision layer + local side" as an intent of its own; it is folded in here: a shared module with one user is a layer waiting for a reason, and this is the reason.
- `collide.mjs` from the board's views.mjs (the words) and act.mjs (the actions); the Party and Collision types generic over the stage, so the board keeps its own Stage.
- `overlapJob` replaces the board's loop; Automata runs the same job for this checkout.
- The repos e2e caught a bug the units did not: `git rev-parse --abbrev-ref HEAD HEAD` abbreviates both, so the "tip" was the branch's name, and the cache, keyed by tips, never saw the merge that fixed it. Now `rev-parse HEAD --abbrev-ref HEAD`.
- The first item put "▲ … bring it in" in the title, which the terminal row does not draw (it draws the label and the detail, as for lost edits); the label now says the action and the detail carries ▲.
- `--out <dir>` on repos.mjs writes the collision's pane and band; `runArgs` and `writeDrawn` in harness.mjs serve it and board.mjs.
