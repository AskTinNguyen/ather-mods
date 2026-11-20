import { expect, test } from 'claude-code/testing'
import { blankSession, newSync, type SessionFile, type Touch } from '../hooks/coord.ts'
import { parseFocus } from '../hooks/focus.ts'
import { applyParked, applySuperFocus, branchOf, parseSuperFocus, parseSuperFocusCommand, planSuperFocus, scan, showSuperFocus, type SfWorld, type SuperFocus } from '../hooks/superfocus.ts'
import { superFocusTool } from '../hooks/superfocushost.ts'

// Intent a5r-superfocus S1-S6: park every other session, choose one, restore the others.
const NOW = new Date(2026, 10, 20, 13, 10).getTime()
const MIN = 60_000
const SID = (id8: string) => `${id8}-1111-4000-8000-000000000000`
const file = (id8: string, o: Partial<SessionFile> = {}): SessionFile => ({ ...blankSession(SID(id8), `lane-${id8}`, `title ${id8}`, NOW), ...o })
const touch = (id8: string, paths: string[]): Touch => ({ session: SID(id8), id8, lane: `lane-${id8}`, paths, updatedAt: NOW })
const ME = 'aaaaaaaa'
const world = (o: Partial<SfWorld> = {}): SfWorld => ({
  me8: ME,
  files: [file(ME), file('bbbbbbbb'), file('cccccccc', { want: { minutes: 30, pie: false, build: false, what: 'x', mode: 'interactive', pausable: true, nextSafe: 'after save', requestedAt: NOW } }), file('dddddddd', { heartbeatAt: NOW - 60 * MIN })],
  lanes: [],
  touches: [touch('bbbbbbbb', ['Content/A.uasset']), touch('eeeeeeee', ['docs/x.md']), touch(ME, ['tools/me.py'])],
  now: NOW,
  sync: null,
  phase: 'none',
  isMerging: false,
  titleOf: id8 => `Title ${id8.slice(0, 2)}`,
  ...o,
})
const ok = <T extends object>(r: T | { refusal: string }): T => {
  if ('refusal' in r) throw new Error(`refused: ${r.refusal}`)
  return r
}
const started = (w = world()) => ok(applySuperFocus(null, w, { kind: 'start' }, 'person'))
const parkAll = (sf: SuperFocus, but: string[] = []): SuperFocus =>
  sf.sessions.filter(s => !but.includes(s.id8)).reduce((acc, s) => ok(applyParked(acc, s.id8, { branch: branchOf(s.id8, NOW), sha: 'abcdef1234567', note: `stopped ${s.id8}` }, NOW)).sf, sf)

test('S1 scan: live sessions and touch owners with their kind; never this session, a gone one without paths, or the sync holder', () => {
  const rows = scan(world())
  expect(rows.map(r => `${r.id8}:${r.kind}`)).toEqual(['bbbbbbbb:wip', 'cccccccc:busy', 'eeeeeeee:wip'])
  const holder = newSync(NOW + 60 * MIN, { session: SID('bbbbbbbb'), id8: 'bbbbbbbb', lane: 'lane-bbbbbbbb' }, 'person', NOW)
  expect(scan(world({ sync: holder, phase: 'planned' })).map(r => r.id8)).toEqual(['cccccccc', 'eeeeeeee'])
})

test('S2 start writes the file, messages every listed session once and prompts this one', () => {
  const r = started()
  expect(r.sf.stage).toBe('parking')
  expect(r.sf.sessions.map(s => s.id8)).toEqual([ME, 'bbbbbbbb', 'cccccccc', 'eeeeeeee'])
  expect(r.sends.map(s => s.session)).toEqual([SID('bbbbbbbb'), SID('cccccccc'), SID('eeeeeeee')])
  expect(r.sends[0]?.text).toContain('park/bbbbbbbb/20261120')
  expect(r.sends[0]?.text).toContain('Content/A.uasset')
  expect(r.prompt).toContain(`park/${ME}/20261120`)
  expect(parseSuperFocus(JSON.stringify(r.sf))).toEqual(r.sf)
})

test('S3 refused in a sync cutoff or freeze, over a merge, and while one runs', () => {
  const sync = newSync(NOW + 10 * MIN, { session: SID('ffffffff'), id8: 'ffffffff', lane: 'sync' }, 'person', NOW)
  expect('refusal' in applySuperFocus(null, world({ sync, phase: 'cutoff' }), { kind: 'start' }, 'p')).toBe(true)
  expect('refusal' in applySuperFocus(null, world({ sync, phase: 'frozen' }), { kind: 'start' }, 'p')).toBe(true)
  expect('refusal' in applySuperFocus(null, world({ isMerging: true }), { kind: 'start' }, 'p')).toBe(true)
  const sf = parkAll(started().sf)
  expect('refusal' in applySuperFocus(sf, world(), { kind: 'start' }, 'p')).toBe(true)
  expect('refusal' in applySuperFocus(sf, world({ sync, phase: 'cutoff' }), { kind: 'choose', name: 'bbbbbbbb', force: false }, 'p')).toBe(true)
})

test('S4 parked records branch, sha and note for its own entry only', () => {
  const sf = started().sf
  const r = ok(applyParked(sf, 'bbbbbbbb', { branch: 'park/bbbbbbbb/20261120', sha: 'abcdef1234567', note: 'half the rig' }, NOW + MIN))
  expect(r.sf.sessions.find(s => s.id8 === 'bbbbbbbb')?.parked).toEqual({ branch: 'park/bbbbbbbb/20261120', sha: 'abcdef1234567', note: 'half the rig', at: NOW + MIN })
  expect(r.sf.sessions.filter(s => s.parked).length).toBe(1)
  expect('refusal' in applyParked(sf, '99999999', { branch: 'x', sha: 'abcdef1', note: '' }, NOW)).toBe(true)
  expect('refusal' in applyParked(sf, 'bbbbbbbb', { branch: 'park/b', sha: 'not a sha', note: '' }, NOW)).toBe(true)
  expect('refusal' in applyParked(sf, 'cccccccc', { branch: 'none', sha: '', note: 'nothing local' }, NOW)).toBe(false)
  expect('refusal' in applyParked(null, 'bbbbbbbb', { branch: 'none', sha: '', note: '' }, NOW)).toBe(true)
})

test('S5 choose waits for every park unless !, gives the Focus, and archives only parked others', () => {
  const sf = started().sf
  expect('refusal' in applySuperFocus(parkAll(sf, ['eeeeeeee']), world(), { kind: 'choose', name: 'bbbbbbbb', force: false }, 'p')).toBe(true)
  const forced = ok(applySuperFocus(parkAll(sf, ['eeeeeeee']), world(), { kind: 'choose', name: 'bbbbbbbb', force: true }, 'p'))
  expect(forced.focusFor).toBe('bbbbbbbb')
  expect(forced.sf.kept).toEqual(['eeeeeeee'])
  const prompt = forced.prompt ?? ''
  expect(prompt).toContain(SID('cccccccc'))
  expect(prompt.split('Keep these')[0]).not.toContain(SID('eeeeeeee'))
  expect(prompt.split('Keep these')[0]).not.toContain(SID(ME))
  expect(prompt).toContain('git cherry-pick --no-commit park/bbbbbbbb/20261120')
  expect(prompt).toContain('git restore --staged -- Content/A.uasset')
  expect('refusal' in applySuperFocus(forced.sf, world(), { kind: 'choose', name: 'cccccccc', force: false }, 'p')).toBe(true)
  expect('refusal' in applySuperFocus(parkAll(sf), world(), { kind: 'choose', name: 'nobody', force: false }, 'p')).toBe(true)
})

test('S6 restore and cancel unarchive and message every archived session with its branch and note', () => {
  const chosen = ok(applySuperFocus(parkAll(started().sf), world(), { kind: 'choose', name: 'bbbbbbbb', force: false }, 'p'))
  const r = ok(applySuperFocus(chosen.sf, world({ now: NOW + 120 * MIN }), { kind: 'restore' }, 'p'))
  expect(r.sf.stage).toBe('ended')
  expect(r.sf.ended).toEqual({ at: NOW + 120 * MIN, how: 'restore' })
  expect(r.prompt).toContain(SID('cccccccc'))
  expect(r.prompt).toContain('park/eeeeeeee/20261120')
  expect(r.prompt).toContain('stopped eeeeeeee')
  expect(r.prompt).not.toContain(SID('bbbbbbbb'))
  expect(r.prompt).not.toContain(SID(ME))
  expect(r.prompt).toContain('this session: bring your own paths back: git cherry-pick --no-commit park/aaaaaaaa/20261120')
  expect(ok(applySuperFocus(parkAll(started().sf), world(), { kind: 'cancel' }, 'p')).sf.ended?.how).toBe('cancel')
  expect('refusal' in applySuperFocus(r.sf, world(), { kind: 'restore' }, 'p')).toBe(true)
  expect(showSuperFocus(r.sf)).toContain('restored')
})

test('S5 the choice gives the Focus in the same change, and is refused when another Focus runs', () => {
  const sf = parkAll(started().sf)
  const live = world({ files: world().files.map(f => ({ ...f, knowsFocus: true as const })) })
  const p = ok(planSuperFocus(sf, live, null, { kind: 'choose', name: 'bbbbbbbb', force: false }, 'p'))
  expect(p.focus?.id8).toBe('bbbbbbbb')
  expect(p.focus?.endsAt).toBe(NOW + 180 * MIN)
  expect(p.r.sf.stage).toBe('focus')
  const other = parseFocus(JSON.stringify({ id8: 'cccccccc', startedAt: NOW - MIN, endsAt: NOW + 60 * MIN }))
  expect('refusal' in planSuperFocus(sf, live, other, { kind: 'choose', name: 'bbbbbbbb', force: false }, 'p')).toBe(true)
  expect(ok(planSuperFocus(null, live, other, { kind: 'start' }, 'p')).focus).toBe(null)
})

test('the superfocus tool: parked writes its own entry, status reads, any other action is refused', async () => {
  let file: string | null = JSON.stringify(started().sf)
  const io = { read: async () => file, write: async (_e: string | null, t: string) => ((file = t), { isWritten: true }), send: async () => true, prompt: async () => undefined, now: async () => NOW, me8: () => 'cccccccc' }
  expect(await superFocusTool(io, { action: 'parked', branch: 'none', sha: '', note: 'nothing local' })).toContain('parked at 13:10')
  expect(parseSuperFocus(file)?.sessions.find(s => s.id8 === 'cccccccc')?.parked?.branch).toBe('none')
  expect(await superFocusTool(io, { action: 'status', branch: '', sha: '', note: '' })).toContain('parking')
  expect(await superFocusTool(io, { action: 'done', branch: '', sha: '', note: '' })).toContain('is no action')
})

test('the command reads start, restore, cancel, a name and its !', () => {
  expect(parseSuperFocusCommand('')).toEqual({ kind: 'show' })
  expect(parseSuperFocusCommand('start')).toEqual({ kind: 'start' })
  expect(parseSuperFocusCommand('Restore')).toEqual({ kind: 'restore' })
  expect(parseSuperFocusCommand('BP enemy templates!')).toEqual({ kind: 'choose', name: 'BP enemy templates', force: true })
  expect(parseSuperFocusCommand('!')).toHaveProperty('usage')
})
