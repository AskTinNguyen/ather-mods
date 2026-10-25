<!-- The pr skill (.agents/skills/pr/SKILL.md) fills these in. A Markdown-only change can drop the review and release sections. -->

## Summary

<!-- What the person sees or does differently, in plain words. The intent and its rev, if there is one. -->

## Gates

<!-- The gates skill's table: base (origin/main <sha>) and after (<sha>). -->

| Gate | Base | After |
| --- | --- | --- |
| unit |  |  |
| board unit |  |  |
| repos e2e |  |  |
| board e2e |  |  |
| S2 e2e |  |  |
| type-check |  |  |
| Paseo type-check, Paseo e2e |  |  |
| `claude plugin validate --strict` / `claude plugin test` |  |  |

- Skipped:
- Same as main:

## Thermo-nuclear review

<!-- One Verdict line, the last round's: Verdict: pass, Verdict: approve or Verdict: block, with nothing else on that line. CI (dev/check-verdict.mjs) fails a ready PR whose verdict is block, missing or said twice. Then each critical finding (C1, C2, ...), what it was, and the commit that fixed it. Then findings left open, each with why, and size numbers (node dev/check-size.mjs). Only the owner can accept a critical finding, here, in writing. -->

Verdict:

| Round | Finding | Fixed in |
| --- | --- | --- |
|  |  |  |

Left open:

## Release

<!-- Each mod's version (old -> new) and its Changes line; or release-later; or no mod changed. Any board-copies note from node dev/check-release.mjs, for the owner. -->

## Paseo

<!-- Shared already, ported (files), or not here yet (the Limits line in paseo/ather-automata/README.md). -->

## Go

<!-- Left empty by the author. The owner writes who and when. -->
