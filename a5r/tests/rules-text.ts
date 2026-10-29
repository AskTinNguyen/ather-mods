// Sentences the rules A5R injects must carry, each for its acceptance row. The test runner has no file system, so
// tests/scan-old-names.mjs checks them in the real files under node; rev32.test.ts checks that what the file says is
// what A5R injects.
export const REQUIRED_RULES_TEXT: { file: string; row: string; text: string }[] = [
  {
    file: 'rules/rules-a5r.md',
    row: 'A90',
    text: 'If you (or your worker) cannot go on because the Editor is held or memory is short, request the Editor with the editor tool (minutes, pie, build, what) before you stop: never end your turn with "I will wait" alone. A5R wakes you when the slot is granted, and when the Editor comes free it may nudge you; then request it if your task was waiting for it.',
  },
  {
    file: 'rules/rules-a5r.md',
    row: 'A102/A121',
    text: 'A fix that needs no C++ rebuild is retested in the same slot (extend for the retest); release when the task\'s Editor work is done or the slot ends, not between a test and its fix; a lane that keeps coming back is offered a Focus.',
  },
  { file: 'rules/rules-a5r.md', row: 'A118', text: 'When the person gives this session a Focus (an `A5R · Focus` notice), the Editor stays yours to the box end through closes, rebuilds and reopens; call the editor tool with `focus_done` when the milestone is reached (a release keeps the lock).' },
  { file: 'rules/rules-a5r.md', row: 'A126', text: 'In the shared checkout the index is shared by every session: commit with `-- <your paths>` (`git commit -m "…" -- <your paths>`); a commit without paths runs only when every staged path is your own, and `commit -a`, `commit --amend` and adding a path another live session is editing are refused.' },
  { file: 'rules/rules-a5r.md', row: 'A120', text: 'While another session has a Focus, Editor launches, builds and headless runs of the shared project, Unreal MCP writes and PIE wait for it: keep working on disk outside its files, build and test in your own worktree, and batch your Editor needs into the turn A5R tells you.' },
]
