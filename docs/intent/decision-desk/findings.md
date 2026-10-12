# decision-desk: Findings

Discoveries that may change the intent. The worker adds entries; the orchestrator resolves them.

<!--
## F-<n> (<YYYY-MM-DD>, rev <r>) | blocking: yes | no | status: open | accepted | rejected

**Found:** <what, with evidence>
**Proposed amendment:** <the change to prompt.md>
**Resolution:** <decision and resulting rev, filled by the orchestrator>
-->

## F-1 (2026-10-12, rev 1) | blocking: no | status: open (director)

Storey keeps a hand-written register of what waits on a person (`docs/ROADMAP-DECISIONS.md`, "Waiting on a person": 26 rows on def6eff, 15 of them the owner's). The desk reads only intents' findings, so rows such as "role-dashboards A1: approve `docs/ROLE-DASHBOARDS.md`" or "build-phase-plan: approve `docs/BUILD-PHASE.md`" are not on it, though they wait on the owner. Several of those rows point at a finding that is on the desk already (decision-log F-2, tender-evaluation F-4); the rest are acceptance rows or whole documents to approve, which have no options to press.

**Options:**
- A (recommended): only findings. The intent skill's findings are the one shape every repository shares; a register row that needs the owner's call becomes a finding in its intent, with options, and so reaches the desk.
- B: findings and registers. The desk also reads a "Waiting on a person" table wherever a repository has one (`docs/*.md`, columns Intent, Row, Who, What), shows the owner's rows without options, and answers them in words.

**Proposed amendment:** none under A. Under B, a D8 for the register's format and an acceptance row for it.
**Resolution:** <pending owner>

## F-2 (2026-10-12, rev 1) | blocking: no | status: open (director)

An answer reaches a repository only when a session runs the desk skill's record step. The page could start that session itself: the `mcp` capability can call the owner's "Claude Code Remote" connector, whose `create_session` opens a cloud session on a repository with a prompt. The page would then offer **Record now** under the answers, and nothing would wait for someone to open a session.

**Options:**
- A (recommended): keep recording in a session the owner (or a schedule) starts. The page stays a page: it keeps answers and asks Claude to explain, and it cannot start work. A schedule can run the record step each morning.
- B: add **Record now**. The page declares `mcp` with `Claude Code Remote` (`create_session`, `list_environments`), and one press opens a session per repository with the plan's prompts. A page that starts sessions must not be shared outside the owner's organisation (an `mcp` declaration bars public sharing), and the first press asks the owner's consent.

**Proposed amendment:** none under A. Under B, a D9 and an acceptance row, proved on one repository with a live press.
**Resolution:** <pending owner>
