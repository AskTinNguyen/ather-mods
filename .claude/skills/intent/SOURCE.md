# Source

Everything in this folder except this file is copied unchanged from [AskTinNguyen/intent](https://github.com/AskTinNguyen/intent/tree/main/skills/intent), `skills/intent/`, at commit `72edeb9d3ed6` (2026-10-08): `SKILL.md`, `assets/contract.md`, `assets/worker-brief.md`, `assets/templates/` and `references/setup.md`. To update it, copy that folder again and change the commit here.

Ather Automata's own prompts point here: `.agents/skills/intent/SKILL.md` to start or close an intent, and `assets/worker-brief.md` for a worker's brief (the brief gate's deny text names it).

What is particular to this repository (areas, statuses, proofs, who may merge) belongs in `docs/intent/README.md`, the project contract the skill reads first, not in edits to these files. Then run `node dev/skills.mjs` so Claude Code finds the skill in `.claude/skills/`.
