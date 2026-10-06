# hai-flow A5: Findings

Discoveries that may change the intent. The worker adds entries; the orchestrator resolves them.

<!--
## F-<n> (<YYYY-MM-DD>, rev <r>) | blocking: yes | no | status: open | accepted | rejected

**Found:** <what, with evidence>
**Proposed amendment:** <the change to prompt.md>
**Resolution:** <decision and resulting rev, filled by the orchestrator>
-->

## F-1 (2026-10-06, rev 1) | blocking: no | status: open (director)

**Found:** two numbers and one rhythm are Hai's to set, not engineering: (a) when a sync happens — planned per sync (`/a5 sync HH:MM`) or fixed daily windows (the paused runbook had 09:00/15:00 checkpoints and 12:00/18:00 trains; Hai turned periodic procedures off on 30/09 and planned today's 16:00 sync himself); (b) the Editor launch gate — free RAM needed before a session may launch the Editor (measured on this machine: Editor idle ≈ 25.7 GB on L_TALab, PIE peak ≈ 31.4 GB); Hai's own PIE gate (5 GB start, 3 GB abort) is fixed and not in question.
**Proposed amendment:** keep D4 (planned syncs, fixed windows optional) and D5 (launch at ≥ 31 GB free with PIE, ≥ 28 GB without, after cleanup) unless Hai picks otherwise.
**Resolution:**
