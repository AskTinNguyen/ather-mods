# Working in ather-mods

Rules for every agent (Claude Code, Cursor, Codex, any other) that changes this repository.

## Every code change gets a thermo-nuclear review

A **code change** is any change to a file that is not prose: `.mjs`, `.js`, `.ts`, `.tsx`, `.json`, `.py`, `.ps1`, `.sh` and the like, anywhere in the repository (the mods, their tests, `dev/`, `paseo/`). A change to Markdown only (READMEs, `docs/intent/`) is not one.

Before you commit a code change you are handing over (a push, a PR, the end of your task), and again before you open or update a PR:

1. **Run the review.** Invoke the skill at [`.agents/skills/thermo-nuclear-code-quality-review/SKILL.md`](.agents/skills/thermo-nuclear-code-quality-review/SKILL.md) (`/thermo-nuclear-code-quality-review` in Claude Code) on the whole change: the branch's diff against the branch it will merge into, not only your latest edit. Follow it as written.
2. **Clear every critical finding.** Critical means anything the skill's **Approval Bar** lists as a presumptive blocker:
   - a plausible code-judo move left on the table that would delete a lot of incidental complexity;
   - a file pushed from under 1,000 lines to over 1,000;
   - ad-hoc branching that tangles an existing flow;
   - feature checks scattered across shared code;
   - an unnecessary abstraction, wrapper, or cast-heavy contract;
   - a duplicated helper, or logic in the wrong layer when there is a clear canonical home.

   Fix each one, then run the review again on the new diff. Repeat until it reports none. A critical finding is never waived by the agent that made the change; only the repository owner can accept one, in writing, with the reason, in the PR.
3. **Keep the gates green while you do it.** A restructuring must not change behaviour: `node dev/test-all.mjs` (set `S2_ROOT` to an S2 checkout when you have one, and `CLAUDE_CODE_TYPES` for the type-check), `claude plugin validate <mod>` and `claude plugin test <mod>` pass before and after.
4. **Show the result.** The PR description has a **Thermo-nuclear review** section: the review's verdict, each critical finding and what fixed it (commit), and any other findings left open with why. Where the work runs as an intent, its `progress.md` records the same as a step.

A change with an open critical finding is not ready: do not open the PR as ready for review, and do not merge it.

## Also

- Follow each mod's own conventions, stated at the top of its files (for Ather Automata: pure rules without `$`, stored values only through `state.mjs`, hooks never block or fail the calls they watch).
- Do not push to `main` or merge without the owner's go.
