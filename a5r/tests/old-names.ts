// A48: the feature's names before A5R (the 0.5–0.11.3 mod and the one before it), and where one may still stand.
// Read by tests/old-names.test.ts (every string a5r builds at run time) and tests/scan-old-names.mjs (every file of
// the mod; the test runner has no file system). The old names are built from pieces so this file does not match itself.
const j = (...parts: string[]) => parts.join('')
/** The old names, in pieces: the upper and lower feature name and the old mod before them. */
export const OLD = { upper: j('A', '5'), lower: j('a', '5'), flow: j('hai', '-', 'flow') }
const U = OLD.upper
const L = OLD.lower

/** One old name: what it is, and how it is found (an a5r name such as A5R, a5r, A5RTMP never matches). */
export type OldName = { name: string; re: RegExp }

export const OLD_NAMES: OldName[] = [
  { name: 'old mod name', re: new RegExp(j(OLD.flow, '|hai', "'s flow|hai", 'flow'), 'i') },
  { name: 'old MCP tool prefix', re: new RegExp(j('mcp__', L, '__')) },
  { name: 'old coordination folder', re: new RegExp(j('Saved/', U, '(?![R\\w])')) },
  { name: 'old command', re: new RegExp(j('(?<![\\w.-])/', L, '(?![r\\w])')) },
  { name: 'old debug tag', re: new RegExp(j(U, 'TMP')) },
  { name: 'lower feature name', re: new RegExp(j('(?<![#\\w])', L, '(?![r\\w])')) },
  { name: 'upper feature name', re: new RegExp(j('(?<![#\\w])', U, '(?![R\\w])')) },
  { name: 'old identifier', re: new RegExp(j('(?<![#\\w])', U, '(?!R|TMP)[A-Z_]\\w*|(?<![#\\w])', L, '(?!r)[A-Z_]\\w*|[a-z]', U, '(?![R\\w])')) },
]

/** Where an old name may stand, each with its reason: a file of the mod (relative path, `/` separators), the old
 * name, and a piece of the line it stands on. Every entry must still match something (a stale one fails the scan). */
export type Exception = { file: string; name: string; line: string; why: string }

const HISTORY = 'Agent 5 Rules; 0.5–0.11.3 tên là'
const DIFF = 'the old tag, still forbidden in a diff'
export const EXCEPTIONS: Exception[] = [
  ...['old mod name', 'lower feature name', 'upper feature name', 'old debug tag'].map(name => ({ file: 'README.md', name, line: HISTORY, why: 'the history line: the names before 0.12 and why the name changed' })),
  { file: 'README.md', name: 'lower feature name', line: j(L, '-kit-v2'), why: "Hermes's own format name, not this feature" },
  { file: 'hooks/a5r.ts', name: 'old identifier', line: j(L, '_core.py'), why: "the Hermes plugin's own file name" },
  { file: 'README.md', name: 'old debug tag', line: j('tag cũ `', U, 'TMP`'), why: DIFF },
  { file: 'rules/rules-a5r.md', name: 'old debug tag', line: j('the old `', U, 'TMP`'), why: DIFF },
  { file: 'rules/config.json', name: 'old debug tag', line: '"forbidden_added"', why: DIFF },
  { file: 'tests/config.fixture.ts', name: 'old debug tag', line: j('"', U, 'TMP"'), why: 'generated from rules/config.json' },
  { file: 'tests/accept.test.ts', name: 'old debug tag', line: 'the old tag stays forbidden', why: 'proves the old tag is still caught' },
  { file: 'tests/kit-markers.test.ts', name: 'old debug tag', line: 'are defined and exercised', why: 'names what the kit scan skips' },
  { file: 'tests/accept-engine.test.ts', name: 'old debug tag', line: 'Glow.cpp', why: 'test data: a debug leftover in a diff' },
  { file: 'tests/posthoc.test.ts', name: 'old debug tag', line: 'const DIRTY', why: 'test data: a debug leftover in a diff' },
  { file: 'tests/pr-tool.test.ts', name: 'old debug tag', line: 'const DIRTY', why: 'test data: a debug leftover in a diff' },
  { file: 'tests/pr-branch.test.ts', name: 'old debug tag', line: '// ', why: "test data (A42): a debug tag in the kit's own folder and in the PR's diff" },
]

/** The old names in one line of text (the names of the patterns that match it). */
export const oldNamesIn = (line: string): string[] => OLD_NAMES.filter(o => o.re.test(line)).map(o => o.name)

/** The hits in a text that no exception covers: `file` is where the text came from ('' for a run-time string). */
export const uncovered = (text: string, file = ''): { line: string; names: string[] }[] =>
  text
    .split(/\r?\n/)
    .map(line => ({ line, names: oldNamesIn(line).filter(name => !EXCEPTIONS.some(x => x.file === file && x.name === name && line.includes(x.line))) }))
    .filter(h => h.names.length > 0)
