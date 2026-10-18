// @ts-check
// Ather Automata: the pane's modes past Home (Everything open, an issue's card, an intent's view,
// Create, Skills, Heading off? and the away window), built with the elements the pane is handed (`el`)
// as rows.mjs builds its lists. Each takes what it shows and its presses, and returns its rows;
// console.mjs picks the mode, makes the presses and adds the foot. Pure: no `$`.

import { AWAY_PRESETS } from './away.mjs'
import { changeGlyph } from './changes.mjs'
import { CREATE_SHOWN } from './home.mjs'
import { AMBER, LIME, QUIET, choiceRow, fit, label, masthead, section, workGroups } from './rows.mjs'
import { GROUP_LABELS, SORT_LABELS } from './worklist.mjs'

/**
 * @typedef {{ width: number, surface: string | undefined, isClicked: boolean }} Frame where a mode is drawn: on the
 *   desktop (clicked) no keys are drawn
 * @typedef {() => void} Press
 * @typedef {{ kind: import('./changes.mjs').Change['kind'], text: string, time: string }} TodayLine one of today's lines in an intent, at its local time
 */

// Every mode's way back: a quiet Back on 0, in a section of its own (`at`, else the button's key).
/** @param {any} el @param {Frame} frame @param {string} key @param {Press} onPress @param {string} [at] */
const backRow = (el, frame, key, onPress, at = key) => section(el, at, [el.Button({ key, label: 'Back', hotkey: frame.isClicked ? undefined : '0', plain: true, dimColor: true, onPress })])

/** @param {Frame} frame @param {string} hotkey */
const keyOf = (frame, hotkey) => (frame.isClicked ? undefined : hotkey)

/**
 * Everything open: its title and how fresh the list is, the search (a field while one is typed), Sort and
 * Group, the groups (rows.mjs workGroups), and Back.
 * @param {any} el @param {Frame} frame
 * @param {{ status: any, look: import('./rows.mjs').Look, groups: Parameters<typeof workGroups>[2] }} view
 * @param {{ onSearch: (words: string) => void, onSearchOpen: Press, onClear: Press, onSort: Press, onGroup: Press, onBack: Press }} on
 */
export const pickRows = (el, frame, { status, look, groups }, on) => {
  const { query, sort, groupBy = 'none', isFocusTaken = false } = groups
  const search = isFocusTaken
    ? el.Input({ key: 'pick-search-field', label: 'Search: ', placeholder: 'title, issue number, area or owner', value: query, submitLabel: 'search', autoFocus: true, onSubmit: on.onSearch })
    : el.Button({ key: 'pick-search', label: query ? `Search: ${fit(query, 24)}` : 'Search…', hotkey: keyOf(frame, 's'), plain: true, onPress: on.onSearchOpen })
  const clear = query ? [el.Button({ key: 'pick-search-clear', label: '✕ Clear', plain: true, dimColor: true, onPress: on.onClear })] : []
  const sorted = el.Button({ key: 'pick-sort', label: `Sort: ${SORT_LABELS[sort]}`, hotkey: keyOf(frame, 'o'), plain: true, onPress: on.onSort })
  const grouped = el.Button({ key: 'pick-group', label: `Group: ${GROUP_LABELS[groupBy]}`, hotkey: keyOf(frame, 'g'), plain: true, onPress: on.onGroup })
  return [
    masthead(el, [el.Text({ key: 'title', bold: true, children: 'Everything open' }), status].filter(Boolean), frame.surface),
    el.Box({ key: 'pick-search-row', flexDirection: 'row', flexWrap: 'wrap', gap: 3, marginTop: 1, children: [search, ...clear, sorted, grouped] }),
    ...workGroups(el, look, groups),
    backRow(el, frame, 'pick-back', on.onBack, 'back'),
  ]
}

/**
 * An issue's card: Start an intent, and Open on GitHub and Copy link when it has a link.
 * @param {any} el @param {Frame} frame
 * @param {{ issue: import('./issues.mjs').Issue, hint: string, open: any }} view `open`: the Open on GitHub control, null without a link
 * @param {{ onStart: Press, onCopy: Press, onBack: Press }} on
 */
export const issueRows = (el, frame, { issue, hint, open }, on) => [
  masthead(el, [label(el, 'brand', `Issue #${issue.number}`, frame.width), el.Text({ key: 'title', bold: true, wrap: 'wrap', children: issue.name }), el.Text({ key: 'meta', color: QUIET, wrap: 'wrap', children: hint })], frame.surface),
  section(el, 'issue-actions', [
    el.Box({
      key: 'issue-buttons',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 3,
      children: [
        el.Button({ key: 'issue-start', label: '＋ Start an intent', variant: 'primary', hotkey: keyOf(frame, '1'), autoFocus: true, onPress: on.onStart }),
        ...(open ? [open, el.Button({ key: 'issue-copy', label: '⧉ Copy link', plain: true, hotkey: keyOf(frame, '3'), onPress: on.onCopy })] : []),
      ],
    }),
    el.Text({ key: 'issue-note', color: QUIET, wrap: 'wrap', children: 'Start an intent: the session checks for overlapping work first, then drafts an intent linked to this issue and shows you the plan. Nothing is written to GitHub.' }),
  ]),
  backRow(el, frame, 'issue-back', on.onBack),
]

/**
 * An intent's view: its goal, proof and holder, Work on this here and Ask about it (unless it is tracked
 * here), where it stands, today's lines, the tracked intent's Next, then Stop tracking and Back.
 * @param {any} el @param {Frame} frame
 * @param {{ key: string, intent: import('./model.mjs').Intent, isHere: boolean, inCheckout: boolean, proof: string, heldBy: string, stands: readonly string[],
 *   today: readonly TodayLine[], next: { label: string, hint: string, isSent: boolean, isQueued: boolean } | null }} view `next`: the tracked intent's step, null for none or another intent
 * @param {{ onAsk: Press, onWork: Press, onChange: (one: TodayLine) => Press, onNext: Press, onStop: Press, onBack: Press }} on
 */
export const intentRows = (el, frame, { key, intent, isHere, inCheckout, proof, heldBy, stands, today, next }, on) => {
  const { width } = frame
  const rows = [
    masthead(
      el,
      [
        label(el, 'brand', 'Intent', width),
        el.Text({ key: 'title', bold: true, children: fit(key, width) }),
        ...(intent.goal ? [el.Text({ key: 'goal', wrap: 'wrap', children: intent.goal })] : []),
        ...(proof ? [el.Text({ key: 'proof', color: QUIET, wrap: 'wrap', children: `Proof: ${proof}` })] : []),
        ...(heldBy ? [el.Text({ key: 'held-by', color: AMBER, wrap: 'wrap', children: heldBy })] : []),
      ],
      frame.surface,
    ),
  ]
  // Looking never tracks: working on it here is its own press, and needs its folder in this
  // checkout. Asking about it never needs one: the session reads it from origin/main if it must.
  const ask = el.Button({ key: 'intent-ask', label: 'Ask about it', variant: inCheckout ? undefined : 'primary', hotkey: keyOf(frame, 'a'), onPress: on.onAsk })
  const work = inCheckout ? [el.Button({ key: 'intent-work', label: 'Work on this here', variant: 'primary', hotkey: keyOf(frame, 'w'), onPress: on.onWork })] : []
  if (!isHere) rows.push(el.Box({ key: 'intent-actions', flexDirection: 'row', gap: 2, marginTop: 1, children: [...work, ask] }))
  if (!isHere && !inCheckout) rows.push(el.Text({ key: 'intent-not-here', color: QUIET, wrap: 'wrap', children: `Not in this checkout yet: pull ${intent.base} to work on it here.` }))
  // Where it stands, from its files: what "See how the work is going" used to ask the session for.
  if (stands.length > 0) {
    rows.push(
      section(el, 'intent-stands', [
        label(el, 'intent-stands-label', 'Where it stands', width),
        ...stands.map((line, index) => el.Text({ key: `stands-${index}`, wrap: 'wrap', children: line })),
        el.Text({ key: 'stands-note', color: QUIET, wrap: 'wrap', children: 'From its files; what is met is what progress.md says.' }),
      ]),
    )
  }
  const lines = today.slice(0, 5)
  rows.push(
    section(el, 'intent-today', [
      label(el, 'intent-today-label', 'Today', width),
      ...(lines.length === 0
        ? [el.Text({ key: 'intent-none', color: QUIET, children: 'Nothing recorded yet today.' })]
        : lines.map((one, index) =>
            el.Box({
              key: `change-${index}`,
              flexDirection: 'row',
              gap: 1,
              width: '100%',
              children: [
                el.Text({ color: one.kind === 'done' ? '#3ccf7a' : one.kind === 'yours' ? LIME : '#8fb8ff', children: changeGlyph(one.kind) }),
                el.Box({ key: `change-${index}-words`, flexGrow: 1, children: [el.Button({ key: `change-${index}-press`, label: fit(one.text, width - 10), plain: true, onPress: on.onChange(one) })] }),
                el.Text({ color: QUIET, children: one.time }),
              ],
            }),
          )),
    ]),
  )
  // The tracked intent's next step, pressed here as on Home.
  if (next) {
    const card = el.Box({ key: 'intent-next-card', flexDirection: 'column', width: '100%', borderStyle: 'round', borderColor: LIME, paddingX: 1, children: [choiceRow(el, { key: 'intent-next-step', title: next.label, detail: next.hint, hotkey: 'n', isSent: next.isSent, isQueued: next.isQueued, width: width - 4, onPress: on.onNext }, frame.isClicked)] })
    rows.push(section(el, 'intent-next', [label(el, 'intent-next-label', 'Next', width, LIME), card]))
  }
  const back = el.Button({ key: 'intent-back', label: 'Back', hotkey: keyOf(frame, '0'), plain: true, dimColor: true, onPress: on.onBack })
  // Stop tracking keeps the view on this intent, which then offers Work on this here again.
  const stop = el.Button({ key: 'intent-untrack', label: 'Stop tracking', hotkey: keyOf(frame, 's'), plain: true, dimColor: true, onPress: on.onStop })
  rows.push(section(el, 'intent-back', isHere ? [el.Box({ key: 'intent-back-row', flexDirection: 'row', gap: 3, children: [stop, back] })] : [back]))
  return rows
}

/**
 * Create: the pack's title and the Editor's line, then each group's first CREATE_SHOWN verbs with More… for
 * the rest (all of them once opened), numbered across the groups.
 * @template {{ id: string, verb: string, description: string }} T
 * @param {any} el @param {Frame} frame
 * @param {{ title: string, meta: string, isHeld: boolean, groups: readonly { group: string, items: readonly T[] }[], opened: ReadonlySet<string> }} view
 * @param {{ onItem: (one: T) => Press, onMore: (group: string) => Press, onBack: Press }} on
 */
export const createRows = (el, frame, { title, meta, isHeld, groups, opened }, on) => {
  const rows = [masthead(el, [label(el, 'brand', 'Create', frame.width), el.Text({ key: 'title', bold: true, children: title }), el.Text({ key: 'meta', color: isHeld ? AMBER : QUIET, wrap: 'wrap', children: meta })], frame.surface)]
  let index = 0
  for (const { group, items } of groups) {
    const shown = opened.has(group) ? items : items.slice(0, CREATE_SHOWN)
    const more = items.length - shown.length
    rows.push(
      section(el, `create-${group}`, [
        label(el, `create-${group}-label`, group, frame.width),
        ...shown.map(one => {
          index += 1
          return choiceRow(el, { key: one.id, title: one.verb, detail: one.description, hotkey: index < 10 ? String(index) : undefined, autoFocus: index === 1, width: frame.width, onPress: on.onItem(one) }, frame.isClicked)
        }),
        ...(more > 0 ? [el.Button({ key: `create-${group}-more`, label: `More… (${more})`, plain: true, dimColor: true, onPress: on.onMore(group) })] : []),
      ]),
    )
  }
  rows.push(backRow(el, frame, 'create-back', on.onBack))
  return rows
}

/**
 * Skills: the pack's groups in its order, each with its skills found here, numbered across the groups.
 * @template {{ id: string, group: string, name: string, description: string }} T
 * @param {any} el @param {Frame} frame
 * @param {{ meta: string, groups: readonly { group: string }[], skills: readonly T[] }} view
 * @param {{ onSkill: (one: T) => Press, onBack: Press }} on
 */
export const skillsRows = (el, frame, { meta, groups, skills }, on) => {
  const rows = [masthead(el, [label(el, 'brand', 'Skills', frame.width), el.Text({ key: 'title', bold: true, children: 'Run a skill' }), el.Text({ key: 'meta', color: QUIET, children: meta })], frame.surface)]
  let index = 0
  for (const { group } of groups) {
    const list = skills.filter(one => one.group === group)
    if (list.length === 0) continue
    rows.push(
      section(el, `skills-${group}`, [
        label(el, `skills-${group}-label`, group, frame.width),
        ...list.map(one => {
          index += 1
          return choiceRow(el, { key: one.id, title: one.name, detail: one.description, hotkey: index < 10 ? String(index) : undefined, autoFocus: index === 1, width: frame.width, onPress: on.onSkill(one) }, frame.isClicked)
        }),
      ]),
    )
  }
  rows.push(backRow(el, frame, 'skills-back', on.onBack))
  return rows
}

/**
 * Heading off?: the away presets, each a press, under what the window holds.
 * @param {any} el @param {Frame} frame @param {{ mandate: string }} view
 * @param {{ onPreset: (preset: (typeof AWAY_PRESETS)[number]) => Press, onBack: Press }} on
 */
export const awayRows = (el, frame, { mandate }, on) => [
  masthead(el, [label(el, 'brand', 'Away', frame.width), el.Text({ key: 'title', bold: true, children: 'Heading off?' }), el.Text({ key: 'meta', color: QUIET, wrap: 'wrap', children: mandate })], frame.surface),
  section(el, 'away-choices', [
    ...AWAY_PRESETS.map((preset, index) => choiceRow(el, { key: `away-${preset.hotkey}`, title: preset.label, detail: preset.choice.untilDone ? 'Ends when the work is done, 24 hours at most.' : `Ends in ${preset.label}.`, hotkey: String(index + 1), autoFocus: index === 0, width: frame.width, onPress: on.onPreset(preset) }, frame.isClicked)),
  ]),
  backRow(el, frame, 'away-back', on.onBack),
]

/**
 * While an away window runs: what the session is doing, what it did so far, and the press that ends the
 * window, with its own foot. Nothing is focused: one stray Enter must not end the window and lift its holds.
 * @param {any} el @param {Frame} frame
 * @param {{ title: string, progress: string, sentence: string, end: { title: string } | undefined }} view `title`: 'Ather' while nothing is tracked
 * @param {{ onEnd: Press }} on
 */
export const awayWindowRows = (el, frame, { title, progress, sentence, end }, on) => [
  masthead(el, [label(el, 'brand', 'Away', frame.width), el.Text({ key: 'title', bold: true, children: fit(title === 'Ather' ? 'The session is working' : title, frame.width) }), el.Text({ key: 'status', children: fit(`🌙 ${progress}`, frame.width) }), el.Text({ key: 'meta', color: QUIET, wrap: 'wrap', children: `So far: ${sentence}.` })], frame.surface),
  ...(end ? [section(el, 'end', [choiceRow(el, { key: 'end', title: end.title, hotkey: 'e', width: frame.width, onPress: on.onEnd }, frame.isClicked)])] : []),
  ...(frame.isClicked ? [] : [section(el, 'foot', [el.Text({ key: 'foot', color: QUIET, children: 'Esc closes' })])]),
]
