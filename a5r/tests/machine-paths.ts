// A111 (rev 37): no path of one machine in the plugin. A drive-letter path (`C:/…`, `E:\…`) may stand in hooks/*.ts only on
// a comment line that labels it as an example ("e.g." or "example"), in rules/*.md only on a line that does, and never in a
// plugin.json option default. A comment line is a whole line of comment: one that starts with `//`, or one inside a
// `/* … */` block opened at the start of a line; a template literal's text (even a line of it starting with `*`) and a
// comment after code on the same line are not. tests/scan-old-names.mjs runs this over the real files (the test runner has
// no file system); tests/rev37.test.ts checks the rule itself. The README and tests/ are not scanned: the README is read by
// hand (placeholders, labelled examples) and the tests' fixtures are paths of a pretend machine. A comment that needs a
// drive path to explain a form says "e.g." (the label this rule reads). Posix home paths are not scanned: A5R runs on Windows.
export const DRIVE_PATH = /(?<![A-Za-z0-9])[A-Za-z]:[\\/]/
const isExample = (line: string): boolean => /\be\.g\.|\bexample\b/i.test(line)

/** Which lines of a TypeScript file are whole comment lines (`//` first, or inside a block opened at a line's start). */
export const commentLines = (lines: readonly string[]): boolean[] => {
  let inBlock = false
  return lines.map(line => {
    const t = line.trim()
    const opens = !inBlock && t.startsWith('/*')
    const isComment = inBlock || opens || t.startsWith('//')
    if (opens) inBlock = !t.slice(2).includes('*/')
    else if (inBlock) inBlock = !t.includes('*/')
    return isComment
  })
}

/** Each line of one mod file (its path relative to the mod) that breaks the rule. */
export const machinePathHits = (rel: string, text: string): string[] => {
  if (rel === '.claude-plugin/plugin.json') {
    const options = ((JSON.parse(text) as { userConfig?: Record<string, { default?: unknown }> }).userConfig ?? {})
    return Object.entries(options).flatMap(([name, o]) => (typeof o.default === 'string' && DRIVE_PATH.test(o.default) ? [`${rel}: option ${name} default ${o.default}`] : []))
  }
  const isCode = /^hooks\/[^/]+\.ts$/.test(rel)
  const isRules = /^rules\/[^/]+\.md$/.test(rel)
  if (!isCode && !isRules) return []
  const lines = text.split(/\r?\n/)
  const comments = isCode ? commentLines(lines) : lines.map(() => true)
  return lines.flatMap((line, i) => (DRIVE_PATH.test(line) && !(isExample(line) && comments[i]) ? [`${rel}:${i + 1}: ${line.trim().slice(0, 160)}`] : []))
}
