# pane-modes: Log

## 2026-10-18

- Created and built after overlap-hardening, ahead of collision-alert, per the Fable review of the proposal.
- The S2 e2e needs an S2 checkout's intents; a stand-in set of six (proof/stand-in-s2.mjs.txt) lets it run here, and its `--layouts` dump is the before/after proof. Kept in the proof, not in `dev/`: the S2 run is for S2's real intents.
- Pick's Back sits in a section keyed `back`, not `pick-back`: the repos e2e's duplicate-key check caught the first version.
