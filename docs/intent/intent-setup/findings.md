# Ather Automata: set up intents in a repository: Findings

Discoveries that may change the intent. The worker adds entries; the orchestrator resolves them.

<!--
## F-<n> (<YYYY-MM-DD>, rev <r>) | blocking: yes | no | status: open | accepted | rejected

**Found:** <what, with evidence>
**Proposed amendment:** <the change to prompt.md>
**Resolution:** <decision and resulting rev, filled by the orchestrator>
-->

## F-1 (2026-10-09, rev 1) | blocking: no | status: accepted

**Found:** on Claude Code 2.1.295 none of the mod's question dialogs open. `ask` in `hooks/console.mjs` calls the `AskUserQuestion` tool through `$.tool.call`, and the engine refuses it: `HooksError: ather-automata: tool.call: runs the AskUserQuestion tool: that is $.ui.ask (host check)` (seen live by printing the caught error in a copy of the plugin). `ask` swallows the error and returns its fallback, so `/ather` in a repository without intents answers with the one line that names `/ather setup` instead of asking. The same fault is on `main` at 0.2.0 for every dialog: the `/away` presets, the role question, the menu where there is no pane, a typed answer. `/ather setup` itself is not affected.
**Options:**
- A (recommended): fix `ask` in its own change. `$.ui.ask` takes option labels without descriptions, so every dialog's wording and the stand-in engine change with it.
- B: fix it inside this intent.
**Proposed amendment:** none to this prompt; A4 stands as written (the question is asked where the engine lets the mod ask, and the fallback names the command).
**Resolution:** accepted A (orchestrator, 2026-10-09): out of this intent's scope, raised as a separate task; rev unchanged.

