// End-to-end run of Ather Board's overlap check (docs/intent/overlap-check) through the stand-in engine, on
// real git: an origin whose main moved under one intent's branch, two intents' branches that change the same
// line, and a teammate's clone that knows only main. Needs no S2_ROOT.
// `node board.mjs [report.md] [--out <dir>]`: `--out` writes the pane as text (72 and 110 columns) and the page.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { createEngine } from './engine.mjs'
import { check } from './screen.mjs'

const args = process.argv.slice(2)
const OUT_AT = args.indexOf('--out')
const OUT = OUT_AT >= 0 ? args[OUT_AT + 1] : ''
const REPORT = args.find((one, at) => !one.startsWith('--') && at !== OUT_AT + 1)
const BOARD = new URL('../../ather-board/', import.meta.url)
const { register } = await import(new URL('hooks/index.mjs', BOARD).href)

const join = (...parts) => path.join(...parts).split(path.sep).join('/')
const BASE = join(fs.realpathSync(fs.mkdtempSync(join(os.tmpdir(), 'ather-board-'))))
fs.writeFileSync(join(BASE, 'gitconfig'), '')
process.env.GIT_CONFIG_GLOBAL = join(BASE, 'gitconfig')
process.env.GIT_CONFIG_NOSYSTEM = '1'

const results = []
const expect = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: typeof detail === 'string' ? detail : JSON.stringify(detail) })
const git = (cwd, args, who = 'Tin Nguyen') => execFileSync('git', ['-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: who, GIT_AUTHOR_EMAIL: 'x@x', GIT_COMMITTER_NAME: who, GIT_COMMITTER_EMAIL: 'x@x' } }).trim()

// ---------------------------------------------------------------- the team's repository

const PROMPT = ({ title, status = 'active', owner, branch, items = 3 }) =>
  [`# ${title}`, '', '- Rev: 1', `- Status: ${status}`, '- Area: Combat', `- Owner: ${owner}`, ...(branch ? [`- Branch: \`${branch}\``] : []), '', '## Goal', '', `${title} for the combat team.`, '', '## Acceptance', '', ...Array.from({ length: items }, (_, at) => `- A${at + 1}: Item ${at + 1}.`), ''].join('\n')
const PROGRESS = met => ['# Progress', '', '## Acceptance', '', '| Item | Verdict |', '| --- | --- |', ...met.map((verdict, at) => `| A${at + 1} | ${verdict} |`), ''].join('\n')
const INTENTS = {
  'dodge-cancel': { title: 'Dodge cancel window', owner: 'Tin Nguyen', branch: 'intent/dodge-cancel', met: ['met', 'met', 'open'] },
  'nine-tail-dash': { title: 'Nine-tail dash', owner: 'Minh Le', branch: 'intent/nine-tail-dash', met: ['met', 'open', 'open'] },
  'mc-vault': { title: 'Vault traversal', owner: 'Sam Vo', branch: 'intent/mc-vault', met: ['open', 'open', 'open'] },
  'hitstop-retune': { title: 'Hit-stop retune', owner: 'Lena Park', branch: 'intent/hitstop-retune', status: 'completed', met: ['met', 'met', 'met'] },
  'boss-cues': { title: 'Boss phase cues', owner: 'Sam Vo', met: ['met', 'open', 'open'] },
}
const origin = join(BASE, 'origin.git')
const tree = join(BASE, 'tree')
git(BASE, ['init', '-q', '--bare', origin])
git(BASE, ['init', '-q', tree])
const commit = (files, message, who) => {
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(join(tree, file)), { recursive: true })
    fs.writeFileSync(join(tree, file), text)
  }
  git(tree, ['add', '-A'])
  git(tree, ['commit', '-q', '-m', message], who)
}
commit(
  {
    ...Object.fromEntries(Object.entries(INTENTS).flatMap(([slug, one]) => [[`docs/intent/${slug}/prompt.md`, PROMPT(one)], [`docs/intent/${slug}/progress.md`, PROGRESS(one.met)]])),
    'Source/Combat/HitStop.cpp': ['float UHitStop::Duration(float Budget)', '{', '  return Budget;', '}', ''].join('\n'),
    'Source/Combat/CombatComponent.cpp': ['void UCombat::OnHit(AActor* Target)', '{', '  HitStop.Apply(Target);', '}', ''].join('\n'),
    'Source/Character/S2CharacterMovement.cpp': ['switch (Mode)', '{', '  case MOVE_Walk: return PhysWalk(dt, Iter);', '}', ''].join('\n'),
    'Content/Maps/Arena.umap': '\u0000\u0001arena',
  },
  'start',
)
git(tree, ['push', '-q', origin, 'HEAD:refs/heads/main'])
const branch = (name, files, who) => {
  git(tree, ['checkout', '-q', '-B', name, 'main'])
  commit(files, name, who)
  git(tree, ['push', '-q', origin, `HEAD:refs/heads/${name}`])
}
branch('intent/dodge-cancel', {
  'Source/Combat/HitStop.cpp': ['float UHitStop::Duration(float Budget)', '{', '  return CanCancel(Dodge) ? 0.f : Budget;', '}', ''].join('\n'),
  'Source/Combat/CombatComponent.cpp': ['void UCombat::OnHit(AActor* Target)', '{', '  if (!Dodge.IsCancelWindow()) HitStop.Apply(Target);', '}', ''].join('\n'),
  'Content/Maps/Arena.umap': '\u0000\u0002dodge',
})
branch('intent/nine-tail-dash', { 'Source/Character/S2CharacterMovement.cpp': ['switch (Mode)', '{', '  case MOVE_Walk: return PhysDash(dt, Iter);', '}', ''].join('\n') }, 'Minh Le')
branch('intent/mc-vault', { 'Source/Character/S2CharacterMovement.cpp': ['switch (Mode)', '{', '  case MOVE_Walk: return PhysVault(dt, Iter);', '}', ''].join('\n') }, 'Sam Vo')
// Lena's retune lands on main after dodge-cancel left it: the same lines.
git(tree, ['checkout', '-q', 'main'])
commit(
  {
    'Source/Combat/HitStop.cpp': ['float UHitStop::Duration(float Budget)', '{', '  return FMath::Min(Budget, 0.070f);', '}', ''].join('\n'),
    'Source/Combat/CombatComponent.cpp': ['void UCombat::OnHit(AActor* Target)', '{', '  HitStop.Apply(Target, FrameBudget());', '}', ''].join('\n'),
    'Content/Maps/Arena.umap': '\u0000\u0003retune',
  },
  'Retune hit-stop to 70 ms',
  'Lena Park',
)
git(tree, ['push', '-q', origin, 'HEAD:refs/heads/main'])

// A teammate's checkout: cloned when main alone was asked for, so it knows no intent's branch until the board fetches.
const clone = join(BASE, 'clone')
git(BASE, ['clone', '-q', '--single-branch', '-b', 'main', origin, clone])
git(clone, ['config', 'user.name', 'Tin Nguyen'])

// ---------------------------------------------------------------- the board in the engine

const engine = createEngine({ root: clone, surfaces: ['terminal'], user: 'Tin Nguyen' })
engine.$.plugin = { name: 'ather-board', root: fileURLToPathSafe(BOARD) }
engine.$.model.complete = async () => ({ isAnswered: false, reason: 'refused' })
register(engine.on)
await engine.start(true)
const pane = (columns = 110, surface = 'terminal') => engine.render('Pane', { bodyColumns: columns }, 'board', surface)
const nodesOf = node => (!node || typeof node !== 'object' ? [] : [node, ...(node.children ?? []).flatMap(nodesOf)])
const byKey = (tree, key) => nodesOf(tree).find(node => node.props?.key === key)
const textOf = (tree, columns) => check(tree, columns).lines.join('\n')
const until = async (test, ms = 20000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 150))) if (await test()) return true
  return false
}

function fileURLToPathSafe(url) {
  return decodeURIComponent(new URL(url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '')
}

await engine.command('board')
await pane()
byKey(await pane(), 'tab-triage')?.props.onPress()
const ready = await until(async () => byKey(await pane(), 'attention-colliding') !== undefined)
const shown = await pane()
const at110 = textOf(shown, 110)
const at72 = textOf(await pane(72), 72)
expect('the board fetched the intents’ branches into a clone that had only main', git(clone, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin']).split('\n').filter(ref => ref !== 'origin').sort().join(' ') === 'origin/intent/dodge-cancel origin/intent/mc-vault origin/intent/nine-tail-dash origin/main', git(clone, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin']))
expect('the completed intent’s branch, and an intent with none, are not fetched', !/hitstop-retune/.test(git(clone, ['for-each-ref', '--format=%(refname)', 'refs/remotes/origin'])))
expect('A5: Triage shows Colliding with its two pairs', ready && /Colliding\s+2/.test(at110), at110)
expect('A5: dodge-cancel against main, three places in amber; the two intents against each other, one', /dodge-cancel ⇄ main ▲ 3 overlaps/.test(at110) && /nine-tail-dash ⇄ ● mc-vault ▲ 1 overlap|mc-vault ⇄ ● nine-tail-dash ▲ 1 overlap/.test(at110), at110.split('\n').filter(line => /⇄/.test(line)))
expect('A5: at 72 columns the pair rows still fit on one line each', at72.split('\n').filter(line => /⇄/.test(line)).length === 2 && at72.split('\n').every(line => line.length <= 72), at72)
expect('the pane draws with no layout problems at 72 and 110 columns', check(shown, 110).problems.length === 0 && check(await pane(72), 72).problems.length === 0, [check(shown, 110).problems, check(await pane(72), 72).problems])
expect('the intents in a collision warn with it in their own rows (Table)', await (async () => {
  byKey(await pane(), 'tab-table')?.props.onPress()
  return /dodge-cancel[^\n]*overlaps main/.test(textOf(await pane(), 110))
})(), textOf(await pane(), 110))

// Open the pair, then press its first action.
byKey(await pane(), 'tab-triage')?.props.onPress()
nodesOf(await pane()).find(node => node.type === 'Button' && node.props.key === 'attention-colliding-|dodge-cancel')?.props.onPress()
const opened = await pane()
const openText = textOf(opened, 110)
expect('A5: opened in place: what happened, each place with both sides’ lines, the binary map, the actions', /origin\/main changed these lines .* \(Lena Park\)\./.test(openText) && /Source\/Combat\/HitStop\.cpp:3/.test(openText) && /main +return FMath::Min\(Budget, 0\.070f\);/.test(openText) && /dodge-cancel +return CanCancel\(Dodge\) \? 0\.f : Budget;/.test(openText) && /Arena\.umap · binary, both changed/.test(openText) && /Bring main into dodge-cancel/.test(openText) && /Draft a note to Lena Park/.test(openText), openText)
const submitsBefore = engine.record.submits.length
byKey(opened, 'collide-|dodge-cancel-bring')?.props.onPress()
await until(async () => engine.record.submits.length > submitsBefore, 3000)
const handed = String(engine.record.submits.at(-1)?.text ?? engine.record.submits.at(-1) ?? '')
expect('A5: Bring main in hands the session one prompt: merge in a worktree, the places named, nothing pushed', /Merge origin\/main into intent\/dodge-cancel/.test(handed) && /HitStop\.cpp:3/.test(handed) && /Do not push until I say\./.test(handed) && engine.record.submits.length === submitsBefore + 1, handed)
expect('the note under the tabs says what was handed over', /Handed to the session: bring main into dodge-cancel/.test(textOf(await pane(), 110)))

// For you: Tin's own collision, after his decisions (he has none here).
byKey(await pane(), 'tab-foryou')?.props.onPress()
const forYou = textOf(await pane(), 110)
expect('A5: For you lists Tin’s collision under its own heading, and not again under his other work', /Colliding\s+1/.test(forYou) && /dodge-cancel ⇄ main/.test(forYou) && !/mc-vault ⇄|nine-tail-dash ⇄/.test(forYou) && !/O T H E R/.test(forYou), forYou)

// Nothing moved: another check merges nothing again.
const mergesBefore = engine.record.gitRuns.filter(run => run.argv.includes('merge-tree')).length
byKey(await pane(), 'tab-triage')?.props.onPress()
await pane()
await new Promise(resolve => setTimeout(resolve, 1500))
await pane()
expect('A6: drawing again merges nothing again', engine.record.gitRuns.filter(run => run.argv.includes('merge-tree')).length === mergesBefore, engine.record.gitRuns.filter(run => run.argv.includes('merge-tree')).length - mergesBefore)
expect('every git call reads without the index lock', engine.record.gitRuns.every(run => run.env.GIT_OPTIONAL_LOCKS === '0'), engine.record.gitRuns.filter(run => run.env.GIT_OPTIONAL_LOCKS !== '0').map(run => run.argv.join(' ')))

// The page: the same rows, the data inside.
const said = String((await engine.command('board', 'open'))?.text ?? '')
const pagePath = /Page written(?: and opened)?: (\S+?)(?: \(|$)/.exec(said)?.[1] ?? ''
const page = pagePath && fs.existsSync(pagePath) ? fs.readFileSync(pagePath, 'utf8') : ''
const data = page ? JSON.parse(/<script type="application\/json" id="board-data">([\s\S]*?)<\/script>/.exec(page)?.[1]?.replace(/<\\\//g, '</') ?? '{}') : {}
expect('A7: /board open writes the page with every collision in its data', (data.records ?? []).filter(one => one.collisions.length > 0).map(one => one.slug).sort().join(' ') === 'dodge-cancel mc-vault nine-tail-dash' && data.overlapNote === '', [said, (data.records ?? []).map(one => [one.slug, one.collisions.length])])
expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)

if (OUT) {
  fs.mkdirSync(OUT, { recursive: true })
  // The pair opened above stays open.
  byKey(await pane(), 'tab-triage')?.props.onPress()
  fs.writeFileSync(join(OUT, 'pane-triage-110.txt'), textOf(await pane(110), 110))
  fs.writeFileSync(join(OUT, 'pane-triage-72.txt'), textOf(await pane(72), 72))
  byKey(await pane(), 'tab-foryou')?.props.onPress()
  fs.writeFileSync(join(OUT, 'pane-foryou-110.txt'), textOf(await pane(110), 110))
  if (page) fs.writeFileSync(join(OUT, 'board.html'), page)
}

await engine.end('other')
fs.rmSync(BASE, { recursive: true, force: true })
const passed = results.filter(one => one.ok).length
const lines = ['# Ather Board: the overlap check', '', `${passed} of ${results.length} checks passed.`, '']
for (const one of results) lines.push(`- ${one.ok ? '✅' : '❌'} ${one.name}${one.ok || !one.detail ? '' : `  \n  ${one.detail}`}`)
if (REPORT) fs.writeFileSync(REPORT, `${lines.join('\n')}\n`)
for (const one of results.filter(r => !r.ok)) console.log(`FAIL ${one.name}\n     ${one.detail.slice(0, 1200)}`)
console.log(`${passed}/${results.length} passed`)
process.exit(passed === results.length ? 0 : 1)
