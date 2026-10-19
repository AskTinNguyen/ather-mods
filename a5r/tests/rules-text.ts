// Sentences the rules A5R injects must carry, each for its acceptance row. The test runner has no file system, so
// tests/scan-old-names.mjs checks them in the real files under node; rev32.test.ts checks that what the file says is
// what A5R injects.
export const REQUIRED_RULES_TEXT: { file: string; row: string; text: string }[] = [
  {
    file: 'rules/rules-a5r.md',
    row: 'A90',
    text: 'If you (or your worker) cannot go on because the Editor is held or memory is short, request the Editor with the editor tool (minutes, pie, build, what) before you stop: never end your turn with "I will wait" alone. A5R wakes you when the slot is granted, and when the Editor comes free it may nudge you; then request it if your task was waiting for it.',
  },
]
