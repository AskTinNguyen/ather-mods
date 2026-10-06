import { expect, test } from 'claude-code/testing'
import { A5, freshTurn, proofProblems, verdict } from '../hooks/a5.ts'
import { CONFIG } from './config.fixture.ts'
import { lockProblem, mcpKind, parseEditorLock, isEditorStartStop } from '../hooks/editor.ts'
import { readMarker, markedTitle, bareTitle, isDirectorCallLine, isFindingsFile } from '../hooks/decision.ts'

// The same shell and path cases the Hermes kit's tests/test_core.py runs, so both engines agree.
const KIT = 'C:/Users/hai.huynh/.claude/mods/hai-flow'
const PLACES = { KIT, HOME: 'C:/Users/hai.huynh', USERPROFILE: 'C:/Users/hai.huynh', TEMP: 'C:/Users/HAI~1.HUY/AppData/Local/Temp', LOCALAPPDATA: 'C:/Users/hai.huynh/AppData/Local', HERMES_HOME: 'C:/Users/hai.huynh/AppData/Local/hermes' }
const ENV = { TEMP: PLACES.TEMP, LOCALAPPDATA: PLACES.LOCALAPPDATA, USERPROFILE: PLACES.USERPROFILE }

const engine = async (_$?: unknown) => new A5(CONFIG, PLACES)

const SHELL: [string, 'deny' | 'ask' | null][] = [
  ['git commit --no-verify -m x', 'deny'],
  ['GIT_LFS_SKIP_SMUDGE=1 git merge origin/main', 'deny'],
  ['$env:GIT_LFS_SKIP_SMUDGE = "1"; git pull', 'deny'],
  ['git sparse-checkout set Source', 'deny'],
  ['grep -n "no-verify" docs/skills/git.md', null],
  ['git commit -m "never use --no-verify here"', null],
  ['git push -u origin HaiHuynh/20261005', null],
  ['git push -u origin HaiHuynh/fix-main-menu', null],
  ['git push origin HEAD:main', 'ask'],
  ['git push --force origin HaiHuynh/x', 'ask'],
  ['git -C E:/Projects/s2 worktree remove E:/wt/x', null],
  ['git restore --staged a.txt', null],
  ['git stash list', null],
  ['git stash', 'ask'],
  ['git reset --hard', 'ask'],
  ['git -C E:/Projects/s2 checkout -- Content/S2/Maps/L_TALab.umap', 'ask'],
  ['git checkout main', 'ask'],
  ['git add .', 'ask'],
  ['git add Source/S2/Foo.cpp', null],
  ['rm -rf "$TEMP/a5probe"', null],
  ['Remove-Item -Recurse -Force $env:TEMP\\a5probe', null],
  ['rm -rf C:/Users/hai.huynh/AppData/Local/Temp/claude/x/scratchpad/probe', null],
  ['rm -f notes.txt', null],
  ['Remove-Item -Force notes.txt', null],
  ['rm -rf E:/Projects/s2/Saved/Logs', 'ask'],
  ['rm -rf build', 'ask'],
  ['powershell -NoProfile -Command "Remove-Item -Recurse E:/Projects/s2/Saved"', 'ask'],
  ['cmd /c "rd /s /q E:\\Projects\\s2\\Saved"', 'ask'],
  ['git rm -r --cached Saved/x', null],
  [`cat ${KIT}/a5/config.json`, null],
  [`D="${KIT}/a5"`, null],
  [`D=x > ${KIT}/a5/config.json`, 'deny'],
  [`echo x > ${KIT}/a5/config.json`, 'deny'],
  [`Set-Content ${KIT}/a5/config.json '{}'`, 'deny'],
  ['Remove-Item .claude/mods/hai-flow/a5/scope', 'deny'],
]

test('shell commands get the same decisions as the Hermes kit', async $ => {
  const a5 = await engine($)
  for (const [cmd, want] of SHELL) expect([cmd, a5.preShell(cmd, '', ENV)?.kind ?? null]).toEqual([cmd, want])
})

test('file writes: shared config asks, the kit and secrets are refused', async $ => {
  const a5 = await engine($)
  const at = (rel: string) => ({ root: 'E:/proj', rel })
  const kind = (path: string, rel: string | null, neu = 'x', old = '') => a5.preEdit(path, old, neu, rel ? at(rel) : { root: null, rel: null })?.kind ?? null
  expect(kind('E:/proj/Config/DefaultEngine.ini', 'Config/DefaultEngine.ini')).toBe('ask')
  expect(kind('E:/proj/Saved/Config/WindowsEditor/X.ini', 'Saved/Config/WindowsEditor/X.ini')).toBe(null)
  expect(kind('E:/proj/Plugins/Foo/Config/DefaultFoo.ini', 'Plugins/Foo/Config/DefaultFoo.ini')).toBe('ask')
  expect(kind('E:/proj/.gitignore', '.gitignore')).toBe('ask')
  expect(kind('E:/proj/Content/S2/.gitignore', 'Content/S2/.gitignore')).toBe(null)
  expect(kind('E:/proj/S2.uproject', 'S2.uproject')).toBe('ask')
  expect(kind('E:/proj/Source/S2/S2.Build.cs', 'Source/S2/S2.Build.cs')).toBe('ask')
  expect(kind(`${KIT}/a5/config.json`, null)).toBe('deny')
  expect(kind('C:/Users/hai.huynh/.claude/settings.json', null)).toBe('ask')
  expect(kind('E:/proj/Source/S2/Foo.cpp', 'Source/S2/Foo.cpp', `k = 'ghp_${'a'.repeat(36)}'`)).toBe('deny')
  expect(kind('E:/proj/Source/S2/Tests/FooTest.cpp', 'Source/S2/Tests/FooTest.cpp', 'TestTrue(a);', 'TestTrue(a);\nTestEqual(b,c);')).toBe('ask')
  expect(kind('E:/proj/Source/S2/Foo.cpp', 'Source/S2/Foo.cpp')).toBe(null)
  expect(a5.preEdit('E:/proj/Source/S2/Foo.cpp', '', 'x', at('Source/S2/Foo.cpp'), ['Source/S2/Combat/*'])?.key).toBe('scope')
})

test('a worker\'s own worktree: shared-checkout rules step aside, the rest stay', async $ => {
  const a5 = await engine($)
  const isShared = (dir: string) => !dir.replace(/\\/g, '/').toLowerCase().startsWith('e:/wt/')
  const kind = (cmd: string, cwd = 'E:/Projects/s2') => a5.preShell(cmd, cwd, ENV, 0, isShared)?.kind ?? null
  expect(kind('git -C E:/wt/x checkout main')).toBe(null)
  expect(kind('git -C E:/wt/x reset --hard')).toBe(null)
  expect(kind('git -C "E:/wt/x" stash')).toBe(null)
  expect(kind('git -C E:/wt/x sparse-checkout set Source')).toBe(null)
  expect(kind('git reset --hard', 'E:/wt/x')).toBe(null)
  expect(kind('git -C E:/wt/x add .')).toBe('ask')
  expect(kind('git -C E:/wt/x push --force origin HaiHuynh/x')).toBe('ask')
  expect(kind('git -C E:/wt/x commit --no-verify -m x')).toBe('deny')
  expect(kind('git checkout main')).toBe('ask')
  expect(kind('git -C E:/Projects/s2 sparse-checkout set Source')).toBe('deny')
  expect(kind('bash -c "git -C E:/Projects/s2 reset --hard"')).toBe('ask')
  const edit = (path: string, rel: string, shared: boolean) => a5.preEdit(path, '', 'x', { root: path.slice(0, -rel.length - 1), rel }, [], shared)?.kind ?? null
  expect(edit('E:/wt/x/Config/DefaultGame.ini', 'Config/DefaultGame.ini', false)).toBe(null)
  expect(edit('E:/wt/x/S2.uproject', 'S2.uproject', false)).toBe(null)
  expect(edit('E:/Projects/s2/Config/DefaultGame.ini', 'Config/DefaultGame.ini', true)).toBe('ask')
  expect(a5.preEdit('C:/Users/hai.huynh/.claude/settings.json', '', 'x', { root: null, rel: null }, [], false)?.kind).toBe('ask')
})

test('with an intent tracked, Verified answers to Ather\'s proof', () => {
  const ev = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, s]) => [k, { state: s }]))
  const techart = { intent: 'tail-vfx', role: 'techart', evidence: ev({ pie: 'pass', editor: 'none' }) }
  expect(proofProblems(techart, 'PIE ✓').some(p => p.includes('Editor check'))).toBe(true)
  expect(proofProblems(techart, 'PIE ✓ · chưa: Editor check (Hai)')).toEqual([])
  expect(proofProblems(techart, 'PIE ✓ · build passed · chưa: Editor check').some(p => p.includes("claims build"))).toBe(true)
  const failed = { intent: 'x', role: 'engineer', evidence: ev({ build: 'fail', automation: 'none' }) }
  expect(proofProblems(failed, 'chưa: tests').some(p => p.includes('FAILED'))).toBe(true)
  expect(proofProblems(failed, 'FAILED: build (Result: Failed) · chưa: tests')).toEqual([])
  const done = { intent: 'x', role: 'engineer', evidence: ev({ build: 'pass', automation: 'pass' }) }
  expect(proofProblems(done, 'Build.bat Result: Succeeded · tests 195/195 passed')).toEqual([])
  const noRole = { intent: 'x', role: '', evidence: ev({ pie: 'pass' }) }
  expect(proofProblems(noRole, 'PIE ok')).toEqual([])
  expect(proofProblems({ ...noRole, evidence: ev({ build: 'pass' }) }, 'build ok').some(p => p.includes('PIE, or build and tests'))).toBe(true)
})

test('the gate: a tracked intent replaces the per-turn check, a failed check still says FAILED', async $ => {
  const a5 = await engine($)
  const t = freshTurn()
  const where = new Map([['e:/proj/source/s2/foo.cpp', { root: 'E:/proj', rel: 'Source/S2/Foo.cpp' }]])
  const now = new Map([['e:/proj/source/s2/foo.cpp', 'int x = 2;\n']])
  a5.recordEdit(t, 'E:/proj/Source/S2/Foo.cpp', ['int x = 2;'])
  const proof = { intent: 'x', role: 'designer', evidence: { pie: { state: 'none' } } }
  expect(a5.gate(t, 'Changed: Foo.cpp\nVerified: chưa: PIE (Build stage)\nRisk: low\nOpen: none', where, now, proof)).toEqual([])
  expect(a5.gate(t, 'Changed: Foo.cpp\nVerified: compiles\nRisk: low\nOpen: none', where, now, proof).some(p => p.includes('not proven yet'))).toBe(true)
  a5.recordShell(t, 'Build.bat S2Editor', 'Result: Failed (x)', true)
  expect(a5.gate(t, 'Changed: Foo.cpp\nVerified: chưa: PIE\nRisk: low\nOpen: none', where, now, proof).some(p => p.includes('FAILED'))).toBe(true)
})

test('director calls Ather lists under Needs you', () => {
  expect(isFindingsFile('E:\\Projects\\s2\\docs\\intent\\tail-vfx\\findings.md')).toBe(true)
  expect(isFindingsFile('E:/Projects/s2/docs/intent/tail-vfx/progress.md')).toBe(false)
  expect(isDirectorCallLine('## F-3 (2026-10-06, rev 2) | blocking: no | status: open (director)')).toBe(true)
  expect(isDirectorCallLine('## F-4 (2026-10-06) | blocking: yes | status: open (worker)')).toBe(true)
  expect(isDirectorCallLine('## F-5 (2026-10-06) | blocking: no | status: open (worker)')).toBe(false)
  expect(isDirectorCallLine('## F-3 (2026-10-06) | blocking: no | status: accepted (director)')).toBe(false)
  expect(isDirectorCallLine('- status: open (director)')).toBe(false)
})

test('a build counts by its own Result line', () => {
  const bat = '"D:/GameEditors/5.8/Engine/Build/BatchFiles/Build.bat" S2Editor Win64 Development'
  expect(verdict(bat, '...\nResult: Failed (OtherCompilationError)', true)[0]).toBe(false)
  expect(verdict(bat, 'Result: Succeeded', true)[0]).toBe(true)
  expect(verdict(`${bat} | tail -3`, 'Total time 12s', true)[0]).toBe(null)
  expect(verdict('pytest -q', '3 passed', true)[0]).toBe(true)
  expect(verdict('pytest -q', '1 failed, 2 passed', true)[0]).toBe(false)
  expect(verdict('pytest -q', '', false)[0]).toBe(false)
})

test('the report gate: honest Verified, files named in any case, leftovers', async $ => {
  const a5 = await engine($)
  const t = freshTurn()
  const where = new Map([['e:/proj/source/s2/foo.cpp', { root: 'E:/proj', rel: 'Source/S2/Foo.cpp' }]])
  a5.recordEdit(t, 'E:/proj/Source/S2/Foo.cpp', ['int x = 2; // A5TMP'])
  a5.recordShell(t, 'Build.bat S2Editor', 'Result: Failed (x)', true)
  const now = new Map([['e:/proj/source/s2/foo.cpp', 'int x = 2; // A5TMP\n']])
  const probs = a5.gate(t, 'Changed: foo.cpp\nVerified: ok\nRisk: none\nOpen: none', where, now)
  expect(probs.some(p => p.includes('FAILED'))).toBe(true)
  expect(probs.some(p => p.includes('A5TMP'))).toBe(true)
  expect(probs.some(p => p.includes('must list'))).toBe(false)
  const clean = new Map([['e:/proj/source/s2/foo.cpp', 'int x = 2;\n']])
  expect(a5.gate(t, 'Changed: Foo.cpp\nVerified: FAILED: Build.bat\nRisk: build broken\nOpen: fix', where, clean)).toEqual([])
  expect(a5.gate(freshTurn(), 'Xong.', where, clean)).toEqual([])
})

test('Editor lock: only the session it names may drive the Editor', () => {
  const held = parseEditorLock('1006-x-s9 (worker) since 14:30, expected end 15:10. session ab12cd34', 14 * 60 + 40)
  expect(held.state).toBe('held')
  expect(lockProblem(held, 'ab12cd34')).toBe(null)
  expect(lockProblem(held, 'ffffffff')).toContain('held by')
  expect(lockProblem(parseEditorLock('free since 15:02', 900), 'ab12cd34')).toContain('free')
  expect(lockProblem(parseEditorLock('', 900), 'ab12cd34')).toContain('unknown')
  expect(mcpKind('{"tool":"McpPieToolset.StartPIE"}')).toBe('pie')
  expect(mcpKind('{"tool":"AssetTools.save_assets"}')).toBe('write')
  expect(mcpKind('{"tool":"EditorTools.SaveAll"}')).toBe('save-all')
  expect(mcpKind('{"tool":"ActorTools.get_actor"}')).toBe('read')
  expect(isEditorStartStop('Stop-Process -Name UnrealEditor -Force')).toBe(true)
  expect(isEditorStartStop('"D:/E/UnrealEditor.exe" E:/Projects/s2/S2.uproject -log')).toBe(true)
  expect(isEditorStartStop('UnrealEditor-Cmd.exe E:/Projects/s2/S2.uproject -run=pythonscript')).toBe(false)
})

test('🟥 and ⏯️ markers', () => {
  const m = readMarker('Xong phần A.\n\n> 🟥 **NEEDS DECISION** — Merge PR #1 now or after the train? / Default if no answer: after the train')
  expect(m).toEqual({ kind: 'decision', question: 'Merge PR #1 now or after the train?', fallback: 'after the train' })
  expect(readMarker('⏯️ Bước 2 xong, chờ Hai xem clip.')).toEqual({ kind: 'waiting' })
  expect(readMarker('Không có gì.')).toBe(null)
  expect(markedTitle('⏯️ 3️⃣ Loco fix', '🟥')).toBe('🟥 3️⃣ Loco fix')
  expect(bareTitle('🟥 3️⃣ Loco fix')).toBe('3️⃣ Loco fix')
})
