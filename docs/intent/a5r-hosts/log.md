# A5R hosts: Prompt Log

Append-only.

## L-1 (2026-11-09) | class: intent | -> rev 1

> A5R used by many people on different machines; nothing specific to my setup; full structure and full protocol; agents configure it; value scales with levels and is useful at the lowest level. Write the design intent for hosts (levels L0-L2, registry, adapters, hand-off protocol, health checks), design only.

## L-2 (2026-11-09) | class: review | -> rev 2

> Review of rev 1 from t6 (review-rev1.md): R1-R7 and smaller items; keep F1-F7 as accepted, add F8 only if R5 stays open. Applied: rev 2 (R5 decided as D19, no F8).

## L-3 (2026-11-09) | class: build | slice S-a

> Implement slice S-a of intent a5r-hosts (L0: hand-off record + cross-machine claims) exactly as the brief from t6 says; work only in this worktree; report with hc send t6. Then (Hải): keep folder claims shared, finish and report to t6.

## L-4 (2026-11-09) | class: build | slice S-b

> Implement slice S-b of intent a5r-hosts (L1: declare a host, health checks C1, C2, C4, C5, C10, ssh and manual adapters, options and state.json, Hosts tile) exactly as the brief from t6 says; work only in this worktree; optional read-only live smoke against the second machine; report with hc send t6.

## L-5 (2026-11-09) | class: decision | -> rev 3

> t6: F-b4 decided (engineering call, in scope): take the proposal. C2 (a) sends b CR LF a CR LF c CR LF to a Windows remote and b LF a LF c LF to POSIX; C2 (b) hash on both sides stays the byte-clean proof; fail text names the default shell as a possible cause. Update prompt.md's C2 row (rev 3, changelog), add the Resolution under F-b4, adjust tests, rerun the C2 live smoke (read-only) and the C2 tests; no full plugin test now (about 7 GB free RAM), note A51 as open. Addendum: in rev 3 also correct Sources S2 (the ??? reading was the sort artifact; measured: the multiplexer failed while DefaultShell was PowerShell and worked right after it was removed, one before/after, mechanism not proven).

## L-6 (2026-11-09) | class: build | slice S-c -> rev 4

> Implement slice S-c of intent a5r-hosts (L1: card publishing on A5R hosts, the origin reading them with the probe card as fallback, suggest and the queue hint, status.json) exactly as the brief from t6 says (decisions 1-5 given: acceptsFrom on the card, the origin's a5r-card read through reach.options.a5rRoot, suggest's reasons and why-not codes with IDLE never alone, the hint in the Editor request reply, status and queued row, the host tool's suggest action); work only in this worktree; optional read-only live check of suggest against the second machine; prompt.md rev 4; report with hc send t6.

## L-7 (2026-11-09) | class: decision

> t6: fix F-c4 inside S-c: the declaration sum that gates the level covers only reach, repo and engine; label, owner and assumed change without dropping the level. Add one test and mark F-c4 resolved.
