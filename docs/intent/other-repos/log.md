# other-repos: Log

## 2026-10-10, the owner, after the setup run in ninetails-monitoring

The session "Ather intents setup" (sipherxyz/ninetails-monitoring, PR 202) sent its report to this session, saying the owner asked it to: the pages and the mod need updating for people on macOS and for people who do not work on S2. In short:

- macOS: the `.claude/skills/intent` link made on macOS is a text file for a teammate on Windows without symlinks; a gate matches only the exact first words (`python3 scripts/validate.py` is not proved by `.venv/bin/python scripts/validate.py`); the README speaks of S2 checkouts and PCs; no trap for a Node newer than `.nvmrc`.
- Not S2: Install says "in an S2 checkout"; the roles and `/ather checked` are the Unreal pack's; a gate written `cd app && …` never matches because commands are split at `&&`; `pnpm --dir web test` proves nothing; a wide gate listed before a narrow one takes the narrow one's run; `hooks/team.mjs` has `MAIN = 'origin/main'` and the repository merges into `develop`; the skill's contract template has no base branch line.
- SETUP.md: the setup prompt does not name `.claude/skills/intent`; nothing says what to do with `skills-lock.json`.

This session checked the main points against `main` (the constant in `team.mjs`, `gates.find` in `packs/web.mjs`, the README's words, SETUP.md's) and proposed four pieces of work. The owner's answer, verbatim:

> merge pr 36 đi, rồi làm cả bốn đề xuất

- Classified as a new intent, rev 1. `pnpm --dir web test` is left as it is (a gate can be written for it); the Node trap and the skill's contract template are Non-Goals.
