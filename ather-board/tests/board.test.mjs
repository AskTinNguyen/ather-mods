// @ts-check
// Ather Board's pure modules: the records (A1, A2), the views' filters, sorts, groups and rollups (A3),
// the open items (A4), the pulse (A5), the page (A7) and the publish prompt (A8). The intents are
// made up here; none is S2's. The last test reads a real git sandbox with readBoard (A1).
import { describe, expect, test } from 'claude-code/testing'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { unreal } from '../hooks/ather/packs/unreal.mjs'
import { publishPrompt, webOf } from '../hooks/index.mjs'
import { renderPage, viewsScript } from '../hooks/page.mjs'
import { toRecord, withCollisions } from '../hooks/records.mjs'
import { EMPTY_BOARD_CACHE, readBoard } from '../hooks/snapshot.mjs'
import * as map from '../hooks/map.mjs'
import * as views from '../hooks/views.mjs'
import { DAY_MS, DEFAULT_LOOK, NO_FILTER, STAGES, STALE_DAYS, WARNINGS, choices, filterRecords, groupRecords, outstanding, pulse, recordsFor, rollup, rollupText, sectionsOf, sortRecords, summaryText, triage } from '../hooks/views.mjs'

// Tuesday 2026-10-13, noon UTC.
const NOW = Date.UTC(2026, 9, 13, 12)

/** @param {{ title: string, status: string, area?: string, owner?: string, items?: string[] }} head */
const prompt = ({ title, status, area, owner, items = [] }) =>
  [`# ${title}`, '', '- Rev: 1', `- Status: ${status}`, ...(area ? [`- Area: ${area}`] : []), ...(owner ? [`- Owner: ${owner}`] : []), '', '## Goal', '', `${title} for the team. More words.`, '', ...(items.length ? ['## Acceptance', '', ...items.map((text, index) => `- A${index + 1}: ${text}`), ''] : [])].join('\n')

/** @param {string[]} verdicts */
const progress = verdicts => ['# Progress', '', '- PR: none yet', '', '## Acceptance', '', '| Item | Verdict | Evidence |', '| --- | --- | --- |', ...verdicts.map((verdict, index) => `| A${index + 1} | ${verdict} | x |`), ''].join('\n')

const DIRECTOR_CALL = '## F-1 (2026-10-10, rev 1) | blocking: yes | status: open (director)\n\nWhich snow do we keep? Options: (a) soft; (b) crisp. Recommendation: (a).\n'

/** @param {string} slug @param {{ prompt: string, progress?: string, findings?: string, age: number, firstAuthor?: string }} files */
const intent = (slug, files) => ({ slug, prompt: files.prompt, progress: files.progress ?? '', findings: files.findings ?? '', files: [], hasDebrief: false, updatedAt: NOW - files.age * DAY_MS, source: /** @type {'main'} */ ('main'), firstAuthor: files.firstAuthor ?? '' })

const FILES = [
  intent('snow-look', { prompt: prompt({ title: 'Snow look', status: 'active', area: 'VFX', owner: 'LamPhung-Art', items: ['Snow.', 'Sand.', 'Proof.'] }), progress: progress(['met', 'open', 'open']), findings: DIRECTOR_CALL, age: 7 }),
  intent('quest-calls', { prompt: prompt({ title: 'Quest calls', status: 'active', area: 'Combat', owner: 'Tin Nguyen', items: ['Calls.', 'Proof.'] }), progress: progress(['met', 'met']), age: 1 }),
  intent('old-tool', { prompt: prompt({ title: 'Old tool', status: 'completed', area: 'Tools', owner: 'DuyTranSipher', items: ['Tool.'] }), progress: progress(['met']), age: 20 }),
  intent('paused-thing', { prompt: prompt({ title: 'Paused thing', status: 'paused (owner review pending)', area: 'Weird', items: ['One.', 'Two.'] }), progress: progress(['met', 'open']), age: 2, firstAuthor: 'haothansipher' }),
  intent('parked-one', { prompt: prompt({ title: 'Parked one', status: 'parked', area: 'Tools', owner: 'trucnguyen', items: ['A thing.'] }), progress: progress(['open']), age: 9 }),
  intent('fresh-plan', { prompt: prompt({ title: 'Fresh plan', status: 'active', area: 'Tools', owner: 'Tin Nguyen' }), age: 0 }),
]
// First commits: three this week (Monday 2026-10-12 on), one in each of the two weeks before, one three weeks back.
const CREATED = { 'snow-look': 9, 'quest-calls': 1, 'old-tool': 21, 'paused-thing': 8, 'parked-one': 0.5, 'fresh-plan': 0 }
const RECORDS = FILES.map(files => toRecord(files, { pack: unreal, createdAt: NOW - CREATED[/** @type {keyof typeof CREATED} */ (files.slug)] * DAY_MS, now: NOW }))
/** @param {string} slug */
const record = slug => RECORDS.find(one => one.slug === slug) ?? RECORDS[0]
/** @param {readonly { slug: string }[]} list */
const slugs = list => list.map(one => one.slug)
/** @param {{ flags: { kind: string }[] }} one */
const kinds = one => one.flags.map(flag => flag.kind)

describe('records (A1, A2)', () => {
  test('one record per intent, read the way Ather reads it: stage, tidied owner, checklist, open items, decisions', () => {
    const snow = record('snow-look')
    expect([snow.stage, snow.owner, snow.area, snow.done, snow.total, snow.calls.map(call => call.id)]).toEqual(['build', 'Lam Phung', 'VFX', 1, 3, ['F-1']])
    expect(snow.openItems.map(item => item.id)).toEqual(['A2', 'A3'])
    expect(snow.createdAt).toBe(NOW - 9 * DAY_MS)
  })
  test('stages: every item met is Ready to close, completed is Done, no checklist is Plan, parked is Parked', () => {
    expect(['quest-calls', 'old-tool', 'fresh-plan', 'parked-one'].map(slug => record(slug).stage)).toEqual(['met', 'done', 'plan', 'parked'])
  })
  test(`flags: decisions waiting, stale after ${STALE_DAYS} days, ready to close, parked without a reason, no checklist`, () => {
    expect(kinds(record('snow-look'))).toEqual(['decisions', 'stale'])
    // A row's age says how long: the warning is the one word.
    expect(record('snow-look').flags.map(flag => flag.label)).toEqual(['1 decision waiting', 'stale'])
    expect(kinds(record('quest-calls'))).toEqual(['met'])
    expect(kinds(record('parked-one'))).toEqual(['unparked'])
    expect(kinds(record('fresh-plan'))).toEqual(['plan'])
  })
  test('a done intent carries no work flags and no open items, however old', () => {
    expect([kinds(record('old-tool')), record('old-tool').openItems.length]).toEqual([[], 0])
  })
  test('data hygiene: a status that is not one of the three words, no Owner line (the first committer stands in), an area outside the list', () => {
    const paused = record('paused-thing')
    expect(kinds(paused)).toEqual(['status', 'owner', 'area'])
    expect(paused.flags[0]?.label).toBe('status "paused" is not active, parked or completed')
    expect([paused.owner, paused.area]).toEqual(['Hao Than', 'Unsorted'])
  })
})

describe('triage (A2)', () => {
  test('needs someone: open intents with a work flag, the worst flag first; done intents never', () => {
    expect(slugs(triage(RECORDS).attention)).toEqual(['snow-look', 'quest-calls', 'parked-one', 'fresh-plan'])
  })
  test('data hygiene is listed apart', () => {
    expect(slugs(triage(RECORDS).hygiene)).toEqual(['paused-thing'])
  })
})

describe('filter, sort, group (A3)', () => {
  test('done hidden unless shown, or unless the Done stage is picked', () => {
    expect(filterRecords(RECORDS, NO_FILTER).some(one => one.stage === 'done')).toBe(false)
    expect(slugs(filterRecords(RECORDS, { ...NO_FILTER, showDone: true }))).toContain('old-tool')
    expect(slugs(filterRecords(RECORDS, { ...NO_FILTER, stage: 'done' }))).toEqual(['old-tool'])
  })
  test('search words start words of the name, title, goal, area or owner; area and owner pick exactly', () => {
    expect(slugs(filterRecords(RECORDS, { ...NO_FILTER, words: 'sno' }))).toEqual(['snow-look'])
    expect(slugs(filterRecords(RECORDS, { ...NO_FILTER, words: 'tin calls' }))).toEqual(['quest-calls'])
    expect(slugs(filterRecords(RECORDS, { ...NO_FILTER, area: 'Tools' }))).toEqual(['parked-one', 'fresh-plan'])
    expect(slugs(filterRecords(RECORDS, { ...NO_FILTER, owner: 'Tin Nguyen' }))).toEqual(['quest-calls', 'fresh-plan'])
  })
  test('sorts: recent, stalest first (done last), closest to done, most open items', () => {
    expect(slugs(sortRecords(RECORDS, 'recent'))).toEqual(['fresh-plan', 'quest-calls', 'paused-thing', 'snow-look', 'parked-one', 'old-tool'])
    expect(slugs(sortRecords(RECORDS, 'stale'))).toEqual(['parked-one', 'snow-look', 'paused-thing', 'quest-calls', 'fresh-plan', 'old-tool'])
    expect(slugs(sortRecords(RECORDS, 'closest')).slice(0, 3)).toEqual(['quest-calls', 'old-tool', 'paused-thing'])
    expect(slugs(sortRecords(RECORDS, 'items')).slice(0, 2)).toEqual(['snow-look', 'paused-thing'])
  })
  test('groups: stages in board order, owners and areas with the most open work first, each with its rollup', () => {
    expect(groupRecords(RECORDS, 'stage', 'recent').map(one => one.key)).toEqual(['plan', 'build', 'met', 'parked', 'done'])
    const areas = groupRecords(RECORDS, 'area', 'recent')
    expect(areas.map(one => one.title)).toEqual(['Combat', 'Tools', 'Unsorted', 'VFX'])
    expect(areas.find(one => one.title === 'Tools')?.rollup).toEqual({ count: 3, done: 1, open: 1, parked: 1, items: 1, calls: 0, stale: 0, at: NOW })
    expect(groupRecords(RECORDS, 'none', 'recent')).toHaveLength(1)
  })
  test('a rollup in one line', () => {
    expect(rollupText(rollup(RECORDS.filter(one => one.area === 'Tools')), NOW)).toBe('3 intents · 1 done · 1 open item · 0m')
  })
  test('the pickers list the areas and owners present', () => {
    expect(choices(RECORDS)).toEqual({ areas: ['Combat', 'Tools', 'Unsorted', 'VFX'], owners: ['Duy Tran', 'Hao Than', 'Lam Phung', 'Tin Nguyen', 'Truc Nguyen'] })
  })
})

describe('open items (A4) and pulse (A5)', () => {
  test('every unmet item of every intent not done, by area or owner, the most first; parked ones are still owed', () => {
    expect(outstanding(RECORDS, 'area').map(one => `${one.title}:${one.count}`)).toEqual(['VFX:2', 'Tools:1', 'Unsorted:1'])
    expect(outstanding(RECORDS, 'owner').map(one => one.title)).toEqual(['Lam Phung', 'Hao Than', 'Truc Nguyen'])
  })
  test('opened by first commit and closed by last commit, per Monday-to-Sunday week, oldest first; stage counts', () => {
    const { weeks, stages } = pulse(RECORDS, NOW, 4)
    expect(weeks.map(one => new Date(one.start).toISOString().slice(0, 10))).toEqual(['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12'])
    expect(weeks.map(one => [one.opened, one.closed])).toEqual([[1, 1], [1, 0], [1, 0], [3, 0]])
    expect(stages.map(one => one.count)).toEqual([1, 2, 0, 1, 1, 1])
  })
  test('the summary line', () => {
    expect(summaryText(RECORDS, NOW)).toBe('6 intents · 4 open · 1 parked · 1 done · this week 3 opened, 0 closed')
  })
})

describe('what each view shows, for the pane and the page alike (A3, A4, A6, A7)', () => {
  test('stages run Plan, then the stages of Ather’s list, then Done', () => {
    expect(STAGES.map(stage => `${stage.glyph} ${stage.label}`)).toEqual(['○ Plan', '● Building', '◐ Proving', '✓ Ready to close', '‖ Parked', '■ Done'])
  })
  test('the filters apply in every view; done intents are hidden only on the board and the table', () => {
    const tools = { ...NO_FILTER, area: 'Tools' }
    expect(slugs(recordsFor(RECORDS, { ...DEFAULT_LOOK, view: 'triage', filter: tools }))).toEqual(['old-tool', 'parked-one', 'fresh-plan'])
    expect(slugs(recordsFor(RECORDS, { ...DEFAULT_LOOK, view: 'table', filter: tools }))).toEqual(['parked-one', 'fresh-plan'])
  })
  test('a row warns with what its stage glyph does not say: decisions, colliding, stale, parked without a reason', () => {
    expect(WARNINGS).toEqual(['decisions', 'colliding', 'stale', 'unparked'])
  })
  test('Triage: a label over a group per reason, the worst first, each row leaving out what its group says (not how many decisions); then data hygiene', () => {
    /** @param {import('../hooks/views.mjs').Section} part @returns {string[]} */
    const shown = part =>
      part.kind === 'label' ? [`${part.isLoud ? 'LOUD ' : ''}${part.title} ${part.meta}`, ...part.groups.flatMap(shown)]
        : part.kind === 'intents' ? [`  ${part.title || part.key} ${part.meta}: ${part.rows.map(row => `${row.record.slug}(${row.flags.map(flag => flag.kind).join(',')})`).join(' ')}`]
          : [part.key]
    expect(sectionsOf(RECORDS, DEFAULT_LOOK, NOW).flatMap(shown)).toEqual([
      'LOUD Needs someone 4',
      '  Decisions waiting 1: snow-look(decisions,stale)',
      '  Ready to close 1: quest-calls()',
      '  Parked without a reason 1: parked-one()',
      '  No acceptance checklist 1: fresh-plan()',
      'Data hygiene 1 not fully readable',
      '  hygiene : paused-thing(status,owner,area)',
    ])
    expect(sectionsOf([], DEFAULT_LOOK, NOW).flatMap(shown)).toEqual(['LOUD Needs someone 0', '  none : ', 'Data hygiene 0 not fully readable', '  hygiene : '])
  })
  test('Table by owner: a section per owner, its rollup as the meta, the owner column left out', () => {
    const look = { ...DEFAULT_LOOK, view: /** @type {const} */ ('table') }
    const parts = sectionsOf(recordsFor(RECORDS, look), look, NOW)
    expect(parts.map(part => part.kind === 'intents' && `${part.title} | ${part.meta} | ${part.hide}`)).toEqual(['Tin Nguyen | 2 intents · 0m | owner', 'Hao Than | 1 intent · 1 open item · 2d | owner', 'Lam Phung | 1 intent · 2 open items · 7d | owner', 'Truc Nguyen | 1 intent · 1 open item · 9d | owner'])
  })
  test('Open items: each intent with its items under it; Areas: a line each, what needs someone apart', () => {
    const [vfx] = sectionsOf(RECORDS, { ...DEFAULT_LOOK, view: 'items' }, NOW)
    expect(vfx?.kind === 'intents' && [vfx.title, vfx.meta, vfx.rows[0]?.items.map(item => item.id)]).toEqual(['VFX', '2 open items', ['A2', 'A3']])
    const [areas] = sectionsOf(RECORDS, { ...DEFAULT_LOOK, view: 'areas' }, NOW)
    expect(areas?.kind === 'lines' && areas.lines.map(line => `${line.title}: ${line.words}${line.warn ? ` / ${line.warn}` : ''}`)).toEqual(['Combat: 1 open · 1d', 'Tools: 1 open · 1 parked · 1 done · 1 items · 0m', 'Unsorted: 1 open · 1 items · 2d', 'VFX: 1 open · 2 items · 7d / 1 decision · 1 stale'])
  })
  test('Board: a group per stage that has intents, in order, no card repeating its column; Pulse has none (the page draws its chart)', () => {
    const board = sectionsOf(RECORDS, { ...DEFAULT_LOOK, view: 'board' }, NOW)
    expect(board.map(part => part.kind === 'intents' && `${part.title} ${part.meta}`)).toEqual(['○ Plan 1', '● Building 2', '✓ Ready to close 1', '‖ Parked 1', '■ Done 1'])
    expect(board.map(part => part.kind === 'intents' && part.rows.map(row => row.flags.map(flag => flag.kind).join(',')).join(' '))).toEqual(['', ' decisions,stale', '', 'unparked', ''])
    expect(sectionsOf([], { ...DEFAULT_LOOK, view: 'board' }, NOW).map(part => part.kind === 'intents' && part.empty)).toEqual(['No intent matches.'])
    expect(sectionsOf(RECORDS, { ...DEFAULT_LOOK, view: 'pulse' }, NOW)).toEqual([])
  })
})

describe('the page (A7) and publishing (A8)', () => {
  const client = fs.readFileSync(new URL('../page/client.js', import.meta.url), 'utf8')
  const css = fs.readFileSync(new URL('../page/board.css', import.meta.url), 'utf8')
  const board = { records: RECORDS, sha: 'abc123def4567890', base: 'main', isRepo: true, readAt: NOW }
  // Every function views.mjs and map.mjs export, called as the views call it; the page's copy must answer the same.
  const SUM = rollup(RECORDS)
  const MODULES = [{ key: 'vfx', name: 'VFX', hint: '' }, { key: 'combat', name: 'Combat', hint: '' }]
  const MAPPING = { 'snow-look': ['vfx'], 'quest-calls': ['combat', 'vfx'] }
  const GRAPH = map.graphOf(RECORDS, MODULES, MAPPING)
  // Two records in a collision, as withCollisions leaves them.
  const COLLIDING = withCollisions(RECORDS, [{ key: '|snow-look', a: '', b: 'snow-look', files: ['VFX/Snow.cpp'], spots: [{ path: 'VFX/Snow.cpp', line: 4, kind: 'lines', ours: 'a', theirs: 'b' }], count: 1, base: { who: 'Lena Park', at: NOW, via: [] } }], 'main')
  /** @type {Record<string, unknown[]>} */
  const CALLS = {
    ageText: [NOW - 3 * DAY_MS, NOW],
    miniBarSvg: [3, 5, 'currentColor'],
    matches: [RECORDS[0], { ...NO_FILTER, words: 'sno' }],
    filterRecords: [RECORDS, { ...NO_FILTER, area: 'Tools', showDone: true }],
    sortRecords: [RECORDS, 'closest'],
    rollup: [RECORDS],
    rollupText: [SUM, NOW],
    rollupLine: [SUM, NOW],
    groupRecords: [RECORDS, 'area', 'stale'],
    worstFlag: [RECORDS[0]],
    triage: [RECORDS],
    outstanding: [RECORDS, 'owner'],
    pulse: [RECORDS, NOW, 4],
    summaryText: [RECORDS, NOW],
    choices: [RECORDS],
    recordsFor: [RECORDS, { ...DEFAULT_LOOK, view: 'table' }],
    sectionsOf: [RECORDS, { ...DEFAULT_LOOK, view: 'items', by: 'owner' }, NOW],
    pickLook: [{ ...DEFAULT_LOOK, filter: { ...NO_FILTER, words: 'snow', showDone: true } }, 'area', 'VFX'],
    rowOf: [RECORDS[0], ['stale']],
    hubsOf: [RECORDS[0], MAPPING],
    moduleSections: [RECORDS, MODULES, MAPPING, 'stale', NOW],
    graphOf: [RECORDS, MODULES, MAPPING],
    seedOf: ['snow-look'],
    layoutGraph: [GRAPH, 1000, 660],
    collisionsOf: [COLLIDING],
    withColliding: [[], COLLIDING, { key: 'attention-colliding', note: '', isDecisions: () => false }],
    pairCount: [[{ kind: 'pairs', pairs: [1, 2] }, { kind: 'intents', rows: [1] }]],
    overlapCount: [3],
    collisionOwners: [views.collisionsOf(COLLIDING)[0]],
    collisionFact: [views.collisionsOf(COLLIDING)[0], NOW],
    spotLabel: [views.collisionsOf(COLLIDING)[0], { path: 'a.umap', line: 0, kind: 'binary', ours: '', theirs: '' }],
    isReason: [{ kind: 'colliding', label: '' }],
    sideLine: [''],
    moreText: [{ ...views.collisionsOf(COLLIDING)[0], count: 4 }],
  }
  test('every function the page is given answers there as it does here, and every one is checked', () => {
    const both = /** @type {Record<string, any>} */ ({ ...views, ...map })
    const names = Object.entries(both).filter(([, value]) => typeof value === 'function').map(([name]) => name)
    expect(names.filter(name => !(name in CALLS))).toEqual([])
    const inPage = new Function(`${viewsScript()}\nreturn { ${names.join(', ')} }`)()
    for (const name of names) expect(JSON.stringify(inPage[name](...(CALLS[name] ?? [])))).toBe(JSON.stringify(both[name](...(CALLS[name] ?? []))))
  })
  test('every view’s sections, as written into the page, are the same, collisions and the overlap note too', () => {
    const inPage = new Function(`${viewsScript()}
return sectionsOf`)()
    for (const view of Object.keys(views.VIEW_LABELS)) {
      const look = { ...DEFAULT_LOOK, view: /** @type {import('../hooks/views.mjs').View} */ (view) }
      expect(JSON.stringify(inPage(RECORDS, look, NOW))).toBe(JSON.stringify(sectionsOf(RECORDS, look, NOW)))
      expect(JSON.stringify(inPage(COLLIDING, look, NOW, 'a note'))).toBe(JSON.stringify(sectionsOf(COLLIDING, look, NOW, 'a note')))
    }
  })
  test('a person or area picked opens the table of theirs, the other filters cleared, done as it was', () => {
    expect(views.pickLook({ ...DEFAULT_LOOK, filter: { ...NO_FILTER, words: 'snow', showDone: true } }, 'area', 'VFX')).toEqual({ ...DEFAULT_LOOK, view: 'table', filter: { ...NO_FILTER, area: 'VFX', showDone: true } })
  })
  test('the browser script compiles', () => {
    expect(typeof new Function(client)).toBe('function')
  })
  test('one self-contained page: data, views and script inside, nothing loaded from elsewhere', () => {
    const html = renderPage(board, { now: NOW, repoName: 'S2', repoUrl: 'https://github.com/example/s2', css, client })
    expect(html).toMatch(/^<!doctype html>/)
    expect(html).toContain('<title>S2 intents</title>')
    expect(html).toContain('"slug":"snow-look"')
    expect(html).toContain('const triage = ')
    expect(html).toContain('origin/main at abc123def456')
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=|@import/)
  })
  test('text that would end a script element is written so it cannot', () => {
    const odd = { ...board, records: [{ ...RECORDS[0], title: 'A </script><script>alert(1)</script> title' }] }
    const html = renderPage(/** @type {any} */ (odd), { now: NOW, repoName: '<b>', repoUrl: '', css, client })
    expect(html).not.toContain('</script><script>alert')
    expect(html).toContain('<title>&lt;b&gt; intents</title>')
  })
  test('the repository\u2019s web address, for PR and issue links', () => {
    expect([webOf('git@github.com:sipherxyz/s2.git'), webOf('https://github.com/sipherxyz/s2.git\n'), webOf('https://gitlab.com/a/b.git')]).toEqual(['https://github.com/sipherxyz/s2', 'https://github.com/sipherxyz/s2', ''])
  })
  test('publishing hands the session one prompt: the file, the server, update in place, change nothing', () => {
    const text = publishPrompt('D:/s2/Saved/AtherAutomata/board/index.html', 's2')
    expect(text).toContain('D:/s2/Saved/AtherAutomata/board/index.html')
    expect(text).toContain('vesper-sites MCP server')
    expect(text).toContain('update that one in place')
    expect(text).toContain('Change nothing in the repository.')
  })
})

describe('reading a checkout (A1)', () => {
  test('origin/main\u2019s intents with their first and last commit dates, through git; a completed one with its progress read', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ather-board-'))
    /** @param {string} cwd @param {string[]} args @param {number} [at] seconds */
    const git = (cwd, args, at = 0) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 'LamPhung-Art', GIT_AUTHOR_EMAIL: 'l@x', GIT_COMMITTER_NAME: 'LamPhung-Art', GIT_COMMITTER_EMAIL: 'l@x', ...(at ? { GIT_AUTHOR_DATE: `${at} +0000`, GIT_COMMITTER_DATE: `${at} +0000` } : {}) }, encoding: 'utf8' })
    const origin = path.join(work, 'origin')
    fs.mkdirSync(path.join(origin, 'docs/intent/snow-look'), { recursive: true })
    git(origin, ['init', '-q', '-b', 'main'])
    const first = Math.floor((NOW - 9 * DAY_MS) / 1000)
    const last = Math.floor((NOW - 2 * DAY_MS) / 1000)
    fs.writeFileSync(path.join(origin, 'docs/intent/snow-look/prompt.md'), FILES[0]?.prompt ?? '')
    git(origin, ['add', '.'])
    git(origin, ['commit', '-q', '-m', 'start'], first)
    fs.writeFileSync(path.join(origin, 'docs/intent/snow-look/progress.md'), FILES[0]?.progress ?? '')
    // A completed intent, whose progress Ather's reader leaves out: the board reads it itself.
    fs.mkdirSync(path.join(origin, 'docs/intent/old-tool'), { recursive: true })
    fs.writeFileSync(path.join(origin, 'docs/intent/old-tool/prompt.md'), FILES[2]?.prompt ?? '')
    fs.writeFileSync(path.join(origin, 'docs/intent/old-tool/progress.md'), FILES[2]?.progress ?? '')
    git(origin, ['add', '.'])
    git(origin, ['commit', '-q', '-m', 'progress'], last)
    const clone = path.join(work, 'clone')
    git(work, ['clone', '-q', origin, clone])
    const root = clone.replace(/\\/g, '/')
    const repo = {
      git: async (/** @type {readonly string[]} */ args, /** @type {{ stdin?: string }} */ { stdin } = {}) => {
        try {
          return { exitCode: 0, stdout: execFileSync('git', ['-C', root, ...args], { input: stdin, encoding: 'utf8' }) }
        } catch (error) {
          return { exitCode: 1, stdout: '', stderr: String(error) }
        }
      },
      read: async (/** @type {string} */ file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null),
      list: async (/** @type {string} */ dir) => fs.readdirSync(dir, { withFileTypes: true }).map(entry => ({ name: entry.name, kind: entry.isDirectory() ? 'dir' : 'file' })),
      mtime: async (/** @type {string} */ file) => (fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0),
      real: async (/** @type {string} */ dir) => fs.realpathSync(dir).replace(/\\/g, '/'),
    }
    const { board, cache } = await readBoard(repo, root, { pack: unreal, base: 'main', cache: EMPTY_BOARD_CACHE, now: NOW })
    fs.rmSync(work, { recursive: true, force: true })
    expect([board.isRepo, board.sha.length, board.records.length]).toEqual([true, 40, 2])
    const snow = board.records.find(one => one.slug === 'snow-look')
    const old = board.records.find(one => one.slug === 'old-tool')
    expect([old?.stage, old?.done, old?.total]).toEqual(['done', 1, 1])
    expect(cache.closed?.progress.has('old-tool')).toBe(true)
    expect([snow?.slug, snow?.owner, snow?.done, snow?.total, snow?.createdAt, snow?.updatedAt]).toEqual(['snow-look', 'Lam Phung', 1, 3, first * 1000, last * 1000])
    expect(cache.created?.sha).toBe(board.sha)
  })
})
