// A111 (rev 37): no path of one machine in the plugin. A drive-letter path (`C:/…`, `E:\…`) may stand in hooks/*.ts only on
// a comment line that labels it as an example ("e.g." or "example"), in rules/*.md only on a line that does, and never in a
// plugin.json option default. tests/scan-old-names.mjs runs this over the real files (the test runner has no file
// system); tests/rev37.test.ts checks the rule itself. The README and tests/ are not scanned: the README is read by hand
// (placeholders, labelled examples) and the tests' fixtures are paths of a pretend machine. A comment that needs a drive path
// to explain a form says "e.g." (the label this rule reads). Posix home paths are not scanned: A5R runs on Windows.
export const DRIVE_PATH = /(?<![A-Za-z0-9])[A-Za-z]:[\\/]/
const isExample = (line: string): boolean => /\be\.g\.|\bexample\b/i.test(line)
const isComment = (line: string): boolean => /^\s*(\/\/|\/\*|\*)/.test(line)

/** Each line of one mod file (its path relative to the mod) that breaks the rule. */
export const machinePathHits = (rel: string, text: string): string[] => {
  if (rel === '.claude-plugin/plugin.json') {
    const options = ((JSON.parse(text) as { userConfig?: Record<string, { default?: unknown }> }).userConfig ?? {})
    return Object.entries(options).flatMap(([name, o]) => (typeof o.default === 'string' && DRIVE_PATH.test(o.default) ? [`${rel}: option ${name} default ${o.default}`] : []))
  }
  const isCode = /^hooks\/[^/]+\.ts$/.test(rel)
  const isRules = /^rules\/[^/]+\.md$/.test(rel)
  if (!isCode && !isRules) return []
  return text.split(/\r?\n/).flatMap((line, i) => (DRIVE_PATH.test(line) && !(isExample(line) && (isRules || isComment(line))) ? [`${rel}:${i + 1}: ${line.trim().slice(0, 160)}`] : []))
}
