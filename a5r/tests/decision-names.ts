// A83 (rev 29): A5R has no decision convention of its own (decisions are Ather's). Its strings may stand only in the
// history, the tests and the A63 clean-up. Read by tests/scan-old-names.mjs (every file of the mod but tests/), which
// prints a second line for this scan. The strings are built from pieces so this file does not match itself.
const j = (...parts: string[]) => parts.join('')

export const DECISION_NAMES: { name: string; re: RegExp }[] = [
  { name: 'decision mark', re: new RegExp(j('\u{1F7E5}'), 'u') },
  { name: 'waiting mark', re: new RegExp(j('⏯'), 'u') },
  { name: 'decision line', re: new RegExp(j('NEEDS', ' DECISION')) },
  { name: 'decision list file', re: new RegExp(j('PENDING', '\\.md')) },
  { name: 'unread flag', re: new RegExp(j('set', '_unread')) },
  { name: 'waiting toast', re: new RegExp(j('Waiting', ' on Hai')) },
]

/** Where one may still stand outside tests/: a file, the name, a piece of its line, and why. */
export const DECISION_EXCEPTIONS: { file: string; name: string; line: string; why: string }[] = [
  { file: 'hooks/decision.ts', name: 'decision mark', line: 'const MARKS', why: 'A63 clean-up: an old mark comes off a title' },
  { file: 'hooks/decision.ts', name: 'waiting mark', line: 'const MARKS', why: 'A63 clean-up: an old mark comes off a title' },
  { file: 'README.md', name: 'decision mark', line: '0.17.0 (rev 29, A83)', why: "history: Hai's words and what 0.17.0 removed" },
  { file: 'README.md', name: 'waiting toast', line: '0.17.0 (rev 29, A83)', why: 'history: what 0.17.0 removed' },
  { file: 'hooks/accept.ts', name: 'decision list file', line: 'as are the file', why: 'A72: rule 5 reads the old file name in evidence as prose, never as unfinished work' },
]

/** The convention's strings in one line. */
export const decisionNamesIn = (line: string): string[] => DECISION_NAMES.filter(d => d.re.test(line)).map(d => d.name)
