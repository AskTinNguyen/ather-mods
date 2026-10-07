import { expect, test } from 'claude-code/testing'
import { A5PANE, PROJ, find, opts, refused, text, world } from './world.ts'

// A47 (rev 14, adversary review of 0.11.2): (a) a diff touching several intents, none of them tracked, is scored under
// the intent whose prompt names most of its paths, a tie is "not scored" naming the candidates (never the
// alphabetically first); (b) a fork PR (`-R upstream/x --head me:branch` from a clone whose origin is the fork) is
// scored against the fork's branch and the upstream remote's base, not refused as another repository.
const G = ['gh', 'pr', 'create'].join(' ')
const prompt = (slug: string, paths: string[]) => [`# ${slug}`, '- Status: active', ...paths.map(p => `Change \`${p}\`.`), '## Acceptance', '- A1: x. Proof: tests.'].join('\n')
const MET = '| Item | Verdict | Evidence |\n| --- | --- | --- |\n| A1 | met | tests: 3 pass 0 fail |\n'
const intents = (w: ReturnType<typeof world>, alpha: string[], beta: string[]) => {
  w.put(`${PROJ}/docs/intent/alpha/prompt.md`, prompt('alpha', alpha))
  w.put(`${PROJ}/docs/intent/alpha/progress.md`, MET)
  w.put(`${PROJ}/docs/intent/beta/prompt.md`, prompt('beta', beta))
  w.put(`${PROJ}/docs/intent/beta/progress.md`, MET)
}
const FILES = 'src/a/x.ts\nsrc/b/y.ts\nsrc/b/z.ts\ndocs/intent/alpha/progress.md\ndocs/intent/beta/progress.md\n'
const git = (files = FILES) => ({ 'diff --name-only': { stdout: files }, 'diff -U0': { stdout: '+++ b/src/b/y.ts\n+const y = 1\n' }, 'worktree list': { stdout: '' } })
const cardHead = async ($: any) => text(find(await $.ui.render(A5PANE as never), 'hai-accept-head'))

test('A47 (a): several intents touched, none tracked: the one whose prompt names most of the diff wins (here beta, not the alphabetically first)', opts(), async ($, on) => {
  const w = world(on, { git: git() })
  intents(w, ['src/a/'], ['src/b/'])
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  await $.command.run({ command: 'a5', args: 'accept' } as never)
  expect(await cardHead($)).toContain('beta · on demand')
})

test('A47 (a): a tie is not scored and names the candidates', opts(), async ($, on) => {
  const w = world(on, { git: git('src/a/x.ts\nsrc/b/y.ts\ndocs/intent/alpha/progress.md\ndocs/intent/beta/progress.md\n') })
  intents(w, ['src/a/'], ['src/b/'])
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  expect(refused(await $.tool.call({ tool: 'Bash', command: `${G} --fill` }))).toBe('A5 · Acceptance — could not read the whole branch diff (the diff touches the intents alpha, beta equally (1 of its paths named by each): open one PR per intent) → open the PR from a slice branch cut from origin/main, or Hai lets this one through')
})

test('A47 (b): a fork PR is scored against the fork branch and the upstream remote\'s base, not refused as another repository', opts(), async ($, on) => {
  const remotes = 'origin\thttps://github.com/me/ather-mods.git (fetch)\norigin\thttps://github.com/me/ather-mods.git (push)\nupstream\tgit@github.com:AskTinNguyen/ather-mods.git (fetch)\nupstream\tgit@github.com:AskTinNguyen/ather-mods.git (push)\n'
  const w = world(on, { git: { ...git('src/a/x.ts\ndocs/intent/alpha/progress.md\n'), 'remote -v': { stdout: remotes }, 'worktree list': { stdout: `worktree ${PROJ}\nbranch refs/heads/intent/x\n` } } })
  intents(w, ['src/a/'], ['src/b/'])
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  expect(refused(await $.tool.call({ tool: 'Bash', command: `${G} -R AskTinNguyen/ather-mods --head me:intent/x --base main --fill` }))).toBeUndefined()
  expect(w.runs.find(r => r.includes('diff --name-only'))).toBe(`git -C ${PROJ} diff --name-only upstream/main...HEAD`)
  // A repository that is no remote of this one is still refused.
  expect(refused(await $.tool.call({ tool: 'Bash', command: `${G} -R someone/else --head intent/x --fill` }))).toContain('the PR is for someone/else, which is not a remote of the repository at E:/proj')
})
