// @ts-check
// Colliding (docs/intent/overlap-check): which intents the check compares, the records with the overlaps
// they are a side of, Triage's Colliding group (second, after the decisions) and For you's, the actions a
// collision offers and the prompts they hand over, and the pane drawing a pair and opening it in place.
// The intents and the overlaps are made up here; none is S2's.
import { describe, expect, test } from 'claude-code/testing'

import { unreal } from '../hooks/ather/packs/unreal.mjs'
import { AMBER } from '../hooks/ather/rows.mjs'
import { collisionActions, spotsText } from '../hooks/act.mjs'
import { forYou } from '../hooks/focus.mjs'
import { boardPane } from '../hooks/pane.mjs'
import { sidesOf, toRecord, withCollisions } from '../hooks/records.mjs'
import { DAY_MS, DEFAULT_LOOK, collisionsOf, sectionsOf } from '../hooks/views.mjs'

const NOW = Date.UTC(2026, 9, 18, 12)
const ME = 'Tin Nguyen'

/** @param {{ title: string, status: string, owner: string, branch?: string, items: string[] }} head */
const prompt = ({ title, status, owner, branch, items }) =>
  [`# ${title}`, '', '- Rev: 1', `- Status: ${status}`, '- Area: Combat', `- Owner: ${owner}`, ...(branch ? [`- Branch: \`${branch}\``] : []), '', '## Goal', '', `${title}.`, '', '## Acceptance', '', ...items.map((text, index) => `- A${index + 1}: ${text}`), ''].join('\n')
/** @param {string[]} verdicts */
const progress = verdicts => ['# Progress', '', '## Acceptance', '', '| Item | Verdict |', '| --- | --- |', ...verdicts.map((verdict, index) => `| A${index + 1} | ${verdict} |`), ''].join('\n')
const CALL = '## F-1 (2026-10-17, rev 1) | blocking: yes | status: open (director)\n\nWhich frame? **Options:**\n- A (recommended): frame 4\n- B: frame 6\n'

/** @param {string} slug @param {{ title: string, status: string, owner: string, branch?: string }} head @param {string} [findings] */
const intent = (slug, head, findings = '') => ({ slug, prompt: prompt({ ...head, items: ['One.', 'Two.', 'Three.'] }), progress: progress(['met', 'met', 'open']), findings, files: [], hasDebrief: false, updatedAt: NOW - DAY_MS, source: /** @type {'main'} */ ('main'), firstAuthor: '' })

const RECORDS = [
  intent('dodge-cancel', { title: 'Dodge cancel window', status: 'active', owner: ME, branch: 'intent/dodge-cancel' }),
  intent('nine-tail-dash', { title: 'Nine-tail dash', status: 'active', owner: 'Minh Le', branch: 'intent/dash' }),
  intent('mc-vault', { title: 'Vault traversal', status: 'active', owner: 'Sam Vo', branch: 'intent/vault' }),
  intent('frame-call', { title: 'Frame call', status: 'active', owner: ME }, CALL),
  intent('parked-x', { title: 'Parked', status: 'parked: waits on art', owner: ME, branch: 'intent/parked' }),
  intent('done-x', { title: 'Done', status: 'completed', owner: ME, branch: 'intent/done' }),
].map(files => toRecord(files, { pack: unreal, createdAt: NOW - 3 * DAY_MS, now: NOW }))

/** @type {import('../hooks/ather/overlap.mjs').Overlap[]} */
const OVERLAPS = [
  {
    key: '|dodge-cancel', a: '', b: 'dodge-cancel', files: ['Combat/HitStop.cpp', 'Maps/Arena.umap'], count: 2, who: 'Lena Park', at: NOW - 6 * 60000,
    spots: [
      { path: 'Combat/HitStop.cpp', line: 42, kind: 'lines', ours: 'return FMath::Min(Budget, 0.070f);', theirs: 'return CanCancel(Dodge) ? 0.f : Budget;' },
      { path: 'Maps/Arena.umap', line: 0, kind: 'binary', ours: '', theirs: '' },
    ],
  },
  {
    key: 'mc-vault|nine-tail-dash', a: 'mc-vault', b: 'nine-tail-dash', files: ['Character/S2CharacterMovement.cpp'], count: 1, who: 'Sam Vo', at: NOW,
    spots: [{ path: 'Character/S2CharacterMovement.cpp', line: 301, kind: 'lines', ours: 'case MOVE_Dash: return PhysVault(dt, Iter);', theirs: 'case MOVE_Dash: return PhysDash(dt, Iter);' }],
  },
]
const COLLIDING = withCollisions(RECORDS, OVERLAPS, 'main')
/** @param {string} slug */
const named = slug => COLLIDING.find(one => one.slug === slug) ?? COLLIDING[0]
/** @param {string} key */
const pair = key => collisionsOf(COLLIDING).find(one => one.key === key) ?? collisionsOf(COLLIDING)[0]

describe('the records (A1, A5)', () => {
  test('the check compares open intents with a Branch line; parked, done and branchless ones are left out', () => {
    expect(sidesOf(RECORDS)).toEqual([
      { key: 'dodge-cancel', branch: 'intent/dodge-cancel' },
      { key: 'nine-tail-dash', branch: 'intent/dash' },
      { key: 'mc-vault', branch: 'intent/vault' },
    ])
  })
  test('each side carries its collisions, the base named by its branch and last author, and a warning naming what it overlaps', () => {
    const dodge = named('dodge-cancel')
    expect(dodge?.collisions[0]?.a).toEqual({ key: '', slug: 'main', owner: 'Lena Park', stage: '', branch: 'main' })
    expect(dodge?.collisions[0]?.b.slug).toBe('dodge-cancel')
    expect(dodge?.flags.at(-1)).toEqual({ kind: 'colliding', label: 'overlaps main' })
    expect([named('mc-vault')?.flags.at(-1)?.label, named('nine-tail-dash')?.flags.at(-1)?.label]).toEqual(['overlaps nine-tail-dash', 'overlaps mc-vault'])
    // Records in no collision are the same records; two intents' collision has no base time.
    expect(named('frame-call')).toBe(RECORDS[3])
    expect([pair('mc-vault|nine-tail-dash')?.at, pair('|dodge-cancel')?.at]).toEqual([0, NOW - 6 * 60000])
  })
  test('an overlap naming an intent the board does not have is dropped', () => {
    expect(withCollisions(RECORDS, [{ ...(OVERLAPS[1] ?? OVERLAPS[0]), key: 'gone|mc-vault', a: 'gone' }], 'main').some(one => one.collisions.length > 0)).toBe(false)
  })
})

/** @param {import('../hooks/views.mjs').Section} part @returns {string[]} */
const shown = part =>
  part.kind === 'label' ? [`${part.title} ${part.meta}`, ...part.groups.flatMap(shown)]
    : part.kind === 'pairs' ? [`  ${part.title} ${part.meta}: ${part.pairs.map(one => one.key).join(' ')}${part.empty ? ` (${part.empty})` : ''}`]
      : part.kind === 'intents' ? [`  ${part.title || part.key} ${part.meta}: ${part.rows.map(row => `${row.record.slug}(${row.flags.map(flag => flag.kind).join(',')})`).join(' ')}`]
        : [part.key]

describe('Triage and For you (A5)', () => {
  test('Colliding comes second, after the decisions, a row a pair, the most places first; its intents keep their own reasons', () => {
    expect(sectionsOf(COLLIDING, DEFAULT_LOOK, NOW).flatMap(shown).slice(0, 3)).toEqual([
      'Needs someone 3',
      '  Decisions waiting 1: frame-call(decisions)',
      '  Colliding 2: |dodge-cancel mc-vault|nine-tail-dash',
    ])
  })
  test('with no decision waiting, Colliding leads; with no collision there is no group, unless git could not check', () => {
    const noCall = COLLIDING.filter(one => one.slug !== 'frame-call')
    expect(sectionsOf(noCall, DEFAULT_LOOK, NOW).flatMap(shown)[1]).toBe('  Colliding 2: |dodge-cancel mc-vault|nine-tail-dash')
    expect(sectionsOf(RECORDS, DEFAULT_LOOK, NOW).flatMap(shown).some(line => line.includes('Colliding'))).toBe(false)
    expect(sectionsOf(RECORDS, DEFAULT_LOOK, NOW, 'git 2.30 cannot check overlaps (needs 2.38)').flatMap(shown)[2]).toBe('  Colliding :  (git 2.30 cannot check overlaps (needs 2.38))')
  })
  test('a filter that hides both sides hides the pair', () => {
    expect(collisionsOf(COLLIDING.filter(one => one.slug !== 'dodge-cancel')).map(one => one.key)).toEqual(['mc-vault|nine-tail-dash'])
  })
  test('For you: your collisions after your decisions, counted with them', () => {
    expect(forYou(COLLIDING, ME).flatMap(shown).slice(0, 3)).toEqual(['For you 2', '  Waiting on your decision 1: frame-call(decisions)', '  Colliding 1: |dodge-cancel'])
    expect(forYou(COLLIDING, 'Minh Le').flatMap(shown)[1]).toBe('  Colliding 1: mc-vault|nine-tail-dash')
  })
})

describe('what a collision offers, and the prompts (A5)', () => {
  const base = pair('|dodge-cancel')
  const two = pair('mc-vault|nine-tail-dash')
  test('the places in words: the line and both sides, a binary file, and how many more', () => {
    expect(spotsText(base)).toBe('Combat/HitStop.cpp:42 (main: return FMath::Min(Budget, 0.070f);; dodge-cancel: return CanCancel(Dodge) ? 0.f : Budget;) and Maps/Arena.umap (binary, both changed)')
    expect(spotsText({ ...base, count: 5 }).endsWith(', and 3 more')).toBe(true)
  })
  test('your intent against the base: bring the base in, then a note to whoever changed it', () => {
    const [bring, note, ...rest] = collisionActions(base, ME, 'main')
    expect([bring?.label, note?.label, rest]).toEqual(['Bring main into dodge-cancel', 'Draft a note to Lena Park', []])
    expect(bring?.prompt).toContain('Merge origin/main into intent/dodge-cancel')
    expect(bring?.prompt).toContain('Combat/HitStop.cpp:42')
    expect(bring?.prompt).toContain('Do not push until I say.')
    expect(note?.prompt).toContain('do not send it')
  })
  test('your intent against a teammate’s: a note to them, and where both stand', () => {
    expect(collisionActions(two, 'Minh Le', 'main').map(one => one.label)).toEqual(['Draft a note to Sam Vo', 'Where they stand'])
    expect(collisionActions(two, 'Sam Vo', 'main').map(one => one.label)).toEqual(['Draft a note to Minh Le', 'Where they stand'])
  })
  test('teammates’ work: ask the owner, or both owners who goes first; nothing is sent', () => {
    expect(collisionActions(base, 'Lena Park', 'main').map(one => one.label)).toEqual(['Ask Tin Nguyen', 'Where they stand'])
    const [ask, about] = collisionActions(two, '', 'main')
    expect([ask?.label, about?.label]).toEqual(['Ask Sam Vo and Minh Le who goes first', 'Where they stand'])
    expect(ask?.prompt).toContain('do not send it')
    expect(about?.prompt).toContain('mc-vault')
    expect(about?.prompt).toContain('nine-tail-dash')
  })
})

describe('the pane (A5)', () => {
  const node = (/** @type {string} */ type) => (/** @type {any} */ props = {}) => ({ type, props, children: [props.children].flat(Infinity).filter(child => child !== null && child !== undefined && child !== false && child !== '') })
  const el = Object.fromEntries(['Box', 'Text', 'Button', 'Input', 'Select', 'Svg'].map(name => [name, node(name)]))
  /** @param {any} tree @returns {any[]} */
  const nodes = tree => (tree && typeof tree === 'object' ? [tree, ...(tree.children ?? []).flatMap(nodes)] : [])
  /** @param {any} tree */
  const texts = tree => nodes(tree).flatMap(one => (one.type === 'Button' ? [one.props.label] : typeof one.props?.children === 'string' ? [one.props.children] : []))
  const job = { state: 'idle', value: null, error: '', at: 0, key: '' }
  const handed = /** @type {{ label: string, prompt: string }[]} */ ([])
  const pressed = /** @type {string[]} */ ([])
  /** @param {Partial<import('../hooks/pane.mjs').PaneModel>} patch */
  const draw = patch =>
    boardPane(
      el,
      /** @type {any} */ ({ records: COLLIDING, look: DEFAULT_LOOK, width: 110, isDesktop: false, now: NOW, title: 'S2 intents', fresh: '', error: '', note: '', me: ME, base: 'main', overlapNote: '', opened: '', suggestions: [], modules: [], brief: job, asked: job, mapped: { ...job, value: { mapping: {}, missing: 0 } }, ...patch }),
      /** @type {any} */ ({ onView: () => () => undefined, onFilter: () => undefined, onPick: () => undefined, onSort: () => undefined, onGroup: () => undefined, onBy: () => undefined, onRow: () => () => undefined, onAction: () => undefined, onDecide: () => undefined, onSuggestion: () => undefined, onBriefAgain: () => undefined, onMapAgain: () => undefined, onAsk: () => undefined, onClearAsk: () => undefined, onOpenPage: () => undefined, onPublish: () => undefined, onSync: () => undefined, onPair: (/** @type {any} */ one) => () => pressed.push(one.key), onCollision: (/** @type {any} */ one) => handed.push(one) }),
    )
  test('a pair is one row in Triage’s columns: the intent’s glyph, what it collides with, the places in amber, the first file quiet', () => {
    const tree = draw({})
    const row = nodes(tree).find(one => one.props?.key === 'row-attention-colliding-|dodge-cancel')
    expect(texts(row).join(' ')).toContain('dodge-cancel ⇄ main')
    expect(nodes(row).find(one => one.props?.key === 'attention-colliding-|dodge-cancel-warn')?.props).toEqual({ key: 'attention-colliding-|dodge-cancel-warn', color: AMBER, children: ' ▲ 2 overlaps' })
    expect(texts(row).join(' ')).toContain('HitStop.cpp +1')
    expect(texts(nodes(tree).find(one => one.props?.key === 'row-attention-colliding-mc-vault|nine-tail-dash')).join(' ')).toContain('nine-tail-dash ⇄ ● mc-vault')
    nodes(row).find(one => one.type === 'Button')?.props.onPress()
    expect(pressed).toEqual(['|dodge-cancel'])
  })
  test('opened in place: what happened, each place with both sides, and its actions, the first primary; a press hands one prompt', () => {
    const open = nodes(draw({ opened: '|dodge-cancel' })).find(one => one.props?.key === 'attention-colliding-|dodge-cancel-open')
    const words = texts(open)
    expect(words[0]).toBe('origin/main changed these lines 6m ago (Lena Park).')
    expect(words.slice(1, 5)).toEqual(['Combat/HitStop.cpp:42', '  main          return FMath::Min(Budget, 0.070f);', '  dodge-cancel  return CanCancel(Dodge) ? 0.f : Budget;', 'Maps/Arena.umap · binary, both changed'])
    const buttons = nodes(open).filter(one => one.type === 'Button')
    expect(buttons.map(one => [one.props.label, one.props.variant ?? ''])).toEqual([['Bring main into dodge-cancel', 'primary'], ['Draft a note to Lena Park', '']])
    buttons[0]?.props.onPress()
    expect(handed.map(one => one.label)).toEqual(['Bring main into dodge-cancel'])
  })
  test('git too old: the Colliding group says so in its place', () => {
    const tree = draw({ records: RECORDS, overlapNote: 'git 2.30 cannot check overlaps (needs 2.38)' })
    expect(texts(nodes(tree).find(one => one.props?.key === 'attention-colliding'))).toEqual(['Colliding', 'git 2.30 cannot check overlaps (needs 2.38)'])
  })
})
