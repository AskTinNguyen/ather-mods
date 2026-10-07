# Souls

How an agent should act in a given role on a given project. A soul is loaded on top of the project's shared knowledge, never instead of it.

| File | Scope | Role id (Ather `unreal` pack) |
|---|---|---|
| [S2-shared-agent-knowledge.md](S2-shared-agent-knowledge.md) | Every agent on S2, any role | all |
| [TechnicalArtist-soul.md](TechnicalArtist-soul.md) | Only what TA work does differently | `techart` |

Layering: hard lines and working laws (shared) → role laws and task cards (soul). A rule lives in exactly one file. Machine-local rules (workstation gates, one person's preferences, a local coordination mod) belong in neither.

Each file ends with a **gap map** against Ather Automata: candidate conventions for the role, a starting point for the work that loads a soul when Ather's role is chosen.

Distilled 2026-10-07 from S2 work on one workstation (agent memories, 24 TA intents, the review of sipherxyz/s2#32710). Re-verify file:line facts before relying on them.
