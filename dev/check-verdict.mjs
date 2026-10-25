// Review verdict. A ready PR that changes code states its thermo-nuclear review's verdict in its description, and the
// verdict is not block (AGENTS.md). CI runs it on every ready pull request (.github/workflows/pr-rules.yml).
//   PR_BODY="$(gh pr view --json body -q .body)" node dev/check-verdict.mjs [--base <ref>]
// The description's "Thermo-nuclear review" section holds exactly one line `Verdict: pass`, `Verdict: approve` or
// `Verdict: block`, and nothing else on that line: the findings and rounds go on the lines after it.
// No review is needed for Markdown only, or for a release that only moves version numbers.
import { pathToFileURL } from 'node:url'
import { VERSION_FILES, baseFrom, changedSince, git, lines, report } from './branch.mjs'

const VERDICTS = ['pass', 'approve', 'block']

/**
 * The verdict a PR description states, or why none can be read.
 * @param {string} body @returns {{ verdict: string } | { problem: string }}
 */
export const verdictOf = body => {
  const text = body.replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '')
  const heading = text.match(/^(#+) *thermo-nuclear review\b.*$/im)
  if (!heading) return { problem: 'no "Thermo-nuclear review" section' }
  const rest = text.slice(heading.index + heading[0].length)
  const next = rest.search(new RegExp(`^#{1,${heading[1].length}} `, 'm'))
  const section = next < 0 ? rest : rest.slice(0, next)
  const said = section.split('\n').map(line => line.replace(/[*_`>]/g, '').trim()).filter(line => /^verdict\s*:/i.test(line))
  if (said.length === 0) return { problem: 'no "Verdict:" line in the "Thermo-nuclear review" section' }
  if (said.length > 1) return { problem: `${said.length} "Verdict:" lines; keep only the last round's` }
  const word = said[0].replace(/^verdict\s*:\s*/i, '').replace(/\.$/, '').toLowerCase()
  return VERDICTS.includes(word) ? { verdict: word } : { problem: `"${said[0]}" is not one of ${VERDICTS.map(one => `Verdict: ${one}`).join(', ')}` }
}

/** True when every changed code file is a version file and only its "version" lines moved. @param {string} mergeBase @param {string[]} code */
const isVersionOnly = (mergeBase, code) =>
  code.every(file => VERSION_FILES.has(file)) &&
  lines(git('diff', '-U0', mergeBase, '--', ...code)).filter(line => /^[+-](?![+-])/.test(line)).every(line => /^[+-]\s*"version": /.test(line))

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { mergeBase, files } = changedSince(baseFrom(process.argv.slice(2), 'check-verdict.mjs'))
  const code = files.filter(file => !file.endsWith('.md'))
  if (code.length === 0) console.log('Markdown only: no review needed (AGENTS.md).')
  else if (isVersionOnly(mergeBase, code)) console.log('Version numbers only: no review needed (AGENTS.md).')
  else {
    const found = verdictOf(process.env.PR_BODY ?? '')
    if ('problem' in found) {
      report('error', `This PR changes ${code.length} code files, and its description has ${found.problem}. Write the last round's verdict as one line, Verdict: pass, approve or block (the pr skill writes it), or keep the PR a draft.`)
      process.exit(1)
    }
    if (found.verdict === 'block') {
      report('error', 'The thermo-nuclear verdict is block: a critical finding is still open (AGENTS.md). Fix it and review again, or keep the PR a draft.')
      process.exit(1)
    }
    console.log(`Thermo-nuclear verdict: ${found.verdict}.`)
  }
}
