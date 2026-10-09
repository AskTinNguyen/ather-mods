import { expect, test } from 'claude-code/testing'
import { commandText, isPrCommand, prCommandRefs } from '../hooks/accept.ts'
import { heredocs, prCalls } from '../hooks/prcmd.ts'
import { PROJ, opts, refused, world } from './world.ts'

// A45 / A46 (rev 14, adversary review of 0.11.2): a PR is found however the command is written, and its refs come from
// the gh call's own words, quote-aware. Every form the review MEASURED as missed on 0.11.2 is here, with the F-4 forms
// that must stay "not a PR". The gh words are assembled so this file's own text is never a command.
const G = ['gh', 'pr', 'create'].join(' ')
const API = ['gh', 'api'].join(' ')

test('A45: every way of running gh pr create (or a POSTing gh api …/pulls) is a PR', () => {
  const prs = [
    `${G} --fill`,
    `GH_TOKEN=x ${G} --fill`,
    `env X=1 ${G} --fill`,
    `env -i X=1 ${G} --fill`,
    `time ${G} --fill`,
    `git push; if ($?) { ${G} --fill }`, // PowerShell 5.1's chain on this machine
    `git push; if ($?) {${G} --fill}`,
    `& ${G} --fill`,
    `& "C:\\Program Files\\GitHub CLI\\gh.exe" pr create --fill`,
    `gh.exe pr create --fill`,
    `/usr/bin/gh pr create --fill`,
    `bash -c "${G} --fill"`,
    `sh -lc '${G} --fill'`,
    `cmd /c "${G} --fill"`,
    `powershell -NoProfile -Command "${G} --fill"`,
    `pwsh -c "git push; ${G} --fill"`,
    `{ ${G} --fill; }`,
    `(${G} --fill)`,
    `echo $(${G} --fill)`,
    `git push && ${G} --fill`,
    `git push || true; ${G} --fill`,
    `if true; then ${G} --fill; fi`,
    `bash <<'EOF'\ngit push\n${G} --fill\nEOF`,
    `pwsh <<EOF\n${G} --fill\nEOF`,
    `${API} repos/o/r/pulls -f head=x -f base=main -f title=t`,
    `${API} -X POST repos/o/r/pulls --input pr.json`,
    `${API} --method=POST /repos/o/r/pulls`,
  ]
  for (const c of prs) expect([c, isPrCommand(c)]).toEqual([c, true])
})

test('A45: text that only mentions a PR stays no PR (the F-4 forms), and reads are not POSTs', () => {
  const not = [
    `echo "${G}"`,
    `echo '${G} --fill'`,
    `cat <<EOF > notes.md\nrun ${G} when done\nEOF`,
    `cat >> notes.md <<'EOF'\n${G} --head x\nEOF\necho ok`,
    `git commit -m "then ${G}"`,
    `# ${G} --fill`,
    `git status # later: ${G}`,
    `${API} repos/o/r/pulls`,
    `${API} -X GET repos/o/r/pulls -f state=open`,
    `${API} repos/o/r/pulls/12`,
    `gh pr view 12`,
    `gh pr list --state open`,
    `grep -n "${G}" a5r/hooks/accept.ts`,
  ]
  for (const c of not) expect([c, isPrCommand(c)]).toEqual([c, false])
})

test('A46: refs from the gh call\'s own words, quote-aware, every flag form; a @file value is a problem', () => {
  expect(prCommandRefs(`${G} -R o/r --body "fix a; b" --head intent/x --fill`)).toEqual({ repo: 'o/r', head: 'intent/x' }) // the review's case
  expect(prCommandRefs(`${G} --title "a && b || c" -B dev -Hfeat -Ro/r`)).toEqual({ repo: 'o/r', head: 'feat', base: 'dev' })
  expect(prCommandRefs(`${G} -H=feat -R=o/r -B=main`)).toEqual({ repo: 'o/r', head: 'feat', base: 'main' })
  expect(prCommandRefs(`${G} --repo=o/r --head=me:feat --base=main`)).toEqual({ repo: 'o/r', head: 'me:feat', base: 'main' })
  expect(prCommandRefs(`${G} --body "-H not-a-head" --head real`)).toEqual({ head: 'real' }) // a value is never a flag
  expect(prCommandRefs(`cd "D:/x y" && ${G} --head feat`)).toEqual({ dir: 'D:/x y', head: 'feat' })
  expect(prCommandRefs(`Set-Location D:/w; if ($?) { ${G} --head feat }`)).toEqual({ dir: 'D:/w', head: 'feat' })
  expect(prCommandRefs(`${API} repos/o/r/pulls --field=head=x -F base=main -H "Accept: application/json"`)).toEqual({ repo: 'o/r', head: 'x', base: 'main' }) // api's -H is a header
  expect(prCommandRefs(`${API} repos/o/r/pulls -fhead=x -f base=main`)).toEqual({ repo: 'o/r', head: 'x', base: 'main' })
  expect(prCommandRefs(`${API} repos/o/r/pulls -F head=@head.txt -f base=main`).problem).toBe("the PR's head is read from a file (@head.txt), which a5r cannot read before the call")
  expect(prCommandRefs(`bash -c "cd D:/w && ${G} --head feat"`)).toEqual({ dir: 'D:/w', head: 'feat' })
})

test('A46: here-documents end at their exact terminator (tabs only for <<-), and a << after # is a comment', () => {
  // A line that merely starts with the word does not end the body; the body is data, so no PR.
  const body = `cat <<EOF\nEOFX\n${G} --fill\n EOF\nEOF\necho done`
  expect([heredocs(body).text, isPrCommand(body)]).toEqual(['cat <<EOF\necho done', false])
  // <<- strips leading tabs only.
  const tabs = `cat <<-END\n\t${G} --fill\n\tEND\necho done`
  expect(heredocs(tabs).text).toBe('cat <<-END\necho done')
  const spaces = `cat <<END\n${G} x\n  END\nEND\necho done`
  expect(heredocs(spaces).text).toBe('cat <<END\necho done')
  // A << after # opens no here-document: the next line is a command.
  const comment = `echo hi # cat <<EOF\n${G} --fill`
  expect([commandText(comment), isPrCommand(comment)]).toEqual([comment, true])
  // A << inside quotes opens none either.
  expect(isPrCommand(`echo "<<EOF"\n${G} --fill`)).toBe(true)
  // A here-string <<< is not a here-document.
  expect(isPrCommand(`cat <<< "x"\n${G} --fill`)).toBe(true)
  expect(prCalls(`bash <<'EOF'\ncd D:/w\n${G} --head feat\nEOF`)[0]).toEqual({ args: ['pr', 'create', '--head', 'feat'], dir: 'D:/w' })
})

test("A45: through the gate: PowerShell's `if ($?) { … }` chain and an env prefix are scored like any PR (refused while the branch fails)", opts(), async ($, on) => {
  // A56 (rev 21): the session tracks an intent whose checklist is complete, so the PR enters acceptance.
  const w = world(on, { out: { 'mcp__ather-automata__status': JSON.stringify({ tracked: { slug: 'x', checklist: '1/1' } }) }, git: { 'diff --name-only': { stdout: 'Source/x.cpp\n' }, 'diff -U0': { stdout: `+++ b/Source/x.cpp\n+int x = 2; // ${['A5R', 'TMP'].join('')}\n` }, 'worktree list': { stdout: '' } } })
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  for (const command of [`git push; if ($?) { ${G} --fill }`, `GH_TOKEN=x ${G} --fill`, `& ${G} --fill`, `bash -c "${G} --fill"`])
    expect([command, (refused(await $.tool.call({ tool: 'Bash', command })) ?? '').split('\n')[0]?.startsWith('A5R · Acceptance —')]).toEqual([command, true])
  expect(w.seen.filter(e => e.tool === 'Bash').length).toBe(0) // none of them ran
})
