// @ts-check
// Ather Board: the pane's look. It draws the sections views.mjs says a view shows, with the elements
// it is handed (`el`) and Ather's own look: a label in spaced-out capitals (lime for what needs someone),
// each group under it a bold title with its rollup, and Ather's row anatomy (rows.mjs workLine: glyph,
// title, warning, bar, count, age, owner). For you leads (focus.mjs), the suggestions above it; the ask
// box sits over every view; a row opens in place with what can be done about it (act.mjs).
// Pure: no `$`; every press arrives as a closure from index.mjs.

import { AMBER, LIME, QUIET, fit, label, section, statusLine, workLine } from './ather/rows.mjs'
import { BAR_CELLS, ageText, miniBar, rowColumns } from './ather/worklist.mjs'
import { ACTION_LABELS, actionsFor } from './act.mjs'
import { isMine } from './ather/model.mjs'
import { paneView } from './focus.mjs'
import { GROUPS, PANE_VIEWS, SORTS, STAGES, VIEW_LABELS, choices, summaryText } from './views.mjs'

/**
 * @typedef {import('./views.mjs').BoardRecord} BoardRecord
 * @typedef {import('./views.mjs').Filter} Filter
 * @typedef {import('./views.mjs').Look} Look
 * @typedef {import('./views.mjs').Section} Section
 * @typedef {import('./views.mjs').IntentGroup} IntentGroup
 * @typedef {ReturnType<typeof rowColumns>} Columns
 * @typedef {import('./views.mjs').View} View
 * @typedef {{
 *   onView: (view: View) => () => void, onFilter: (patch: Partial<Filter>) => void, onSort: () => void, onGroup: () => void, onBy: () => void,
 *   onPick: (by: 'owner' | 'area', value: string) => void, onRow: (record: BoardRecord) => () => void, onOpenPage: () => void, onPublish: () => void, onSync: () => void,
 *   onAction: (kind: import('./act.mjs').ActionKind, records: readonly BoardRecord[]) => void, onDecide: (record: BoardRecord, call: import('./views.mjs').Call, letter: string) => void,
 *   onSuggestion: (suggestion: Suggestion) => void, onBriefAgain: () => void, onMapAgain: () => void, onAsk: (question: string) => void, onClearAsk: () => void,
 * }} Actions
 * @typedef {import('./focus.mjs').Suggestion} Suggestion
 * @typedef {{
 *   records: BoardRecord[], look: Look, width: number, isDesktop: boolean, now: number, title: string, fresh: string, error: string, note: string,
 *   me: string, opened: string, suggestions: Suggestion[], modules: import('./modules.mjs').Module[],
 *   brief: import('./assist.mjs').Job<import('./brief.mjs').Brief | null>, asked: import('./assist.mjs').Job<import('./brief.mjs').Answer | null>,
 *   mapped: import('./assist.mjs').Job<import('./assist.mjs').Mapped>,
 * }} PaneModel `opened`: the key of the intent opened in place ('' none); `suggestions`: the brief's and the board's own, merged;
 *   `brief`, `asked`, `mapped`: the model's jobs (assist.mjs)
 */

// A list longer than this ends in a line pointing at the page, which shows them all.
export const ROW_CAP = 60

/** @param {string} stage */
const glyphOf = stage => STAGES.find(one => one.key === stage)?.glyph ?? '·'

// A heading and its meta beside it, quiet: a label spaced out, or a group's title in bold (D7 of Ather's look).
/** @param {any} el @param {string} key @param {any} head @param {string} meta */
const withMeta = (el, key, head, meta) => el.Box({ key, flexDirection: 'row', gap: 2, children: [head, ...(meta ? [el.Text({ key: `${key}-meta`, color: QUIET, wrap: 'truncate', children: meta })] : [])] })

// A row's cells as Ather's list has them; in a group of one owner, that column shows the area.
/** @param {PaneModel} model @param {IntentGroup} part @param {import('./views.mjs').Row} one @returns {import('./ather/worklist.mjs').RowCells} */
const cellsOf = (model, part, { record, flags }) => ({
  glyph: glyphOf(record.stage),
  title: record.slug,
  warn: flags.map(flag => flag.label).join(' · '),
  repo: '',
  bar: miniBar(record.done, record.total),
  count: record.total ? `${record.done}/${record.total}` : '',
  age: ageText(record.updatedAt, model.now),
  owner: part.hide === 'owner' ? record.area : record.owner,
})

// A group of intents as lines: its head, then one anatomy, the right-hand columns (`cols`) lined up across
// every group the view shows; Open items lists each intent's items under its row.
/** @param {any} el @param {PaneModel} model @param {Actions} actions @param {IntentGroup} part @param {Columns} cols */
const groupLines = (el, model, actions, part, cols) => {
  const shown = part.rows.slice(0, ROW_CAP)
  const more = part.rows.length - shown.length
  return [
    ...(part.title ? [withMeta(el, `${part.key}-head`, el.Text({ key: `${part.key}-title`, bold: true, children: fit(part.title, Math.max(8, model.width - part.meta.length - 2)) }), part.meta)] : []),
    ...shown.flatMap(one => [
      workLine(el, { key: `${part.key}-${one.record.key}`, cells: cellsOf(model, part, one), cols, width: model.width, ownerColour: QUIET, onPress: actions.onRow(one.record), isClicked: model.isDesktop }),
      ...(model.opened === one.record.key ? [opened(el, model, actions, one.record, part.key)] : []),
      ...one.items.map(item => el.Text({ key: `${part.key}-${one.record.key}-${item.id}`, color: QUIET, wrap: 'truncate', children: fit(`   ${item.id} ${item.text}`, model.width) })),
    ]),
    ...(more > 0 ? [el.Text({ key: `${part.key}-more`, color: QUIET, children: `+${more} more: o opens the page with every one` })] : []),
    ...(part.rows.length === 0 && part.empty ? [el.Text({ key: `${part.key}-empty`, color: QUIET, children: part.empty })] : []),
  ]
}

// An intent opened in place: its goal, its decisions with their options (the owner's own to answer), and
// what can be done about it, its next action first. Every press hands the session one prompt (act.mjs).
/** @param {any} el @param {PaneModel} model @param {Actions} actions @param {BoardRecord} record @param {string} at */
const opened = (el, model, actions, record, at) => {
  const isOwn = isMine(record, model.me)
  const key = `${at}-${record.key}-open`
  const [next, ...rest] = actionsFor(record, isOwn)
  return el.Box({
    key,
    flexDirection: 'column',
    width: '100%',
    paddingLeft: 2,
    marginBottom: 1,
    children: [
      ...(record.goal ? [el.Text({ key: `${key}-goal`, color: QUIET, wrap: 'wrap', children: record.goal })] : []),
      ...(isOwn
        ? record.calls.map(call =>
            el.Box({ key: `${key}-${call.id}`, flexDirection: 'column', marginTop: 1, children: [
              el.Text({ key: `${key}-${call.id}-title`, color: AMBER, wrap: 'wrap', children: `${call.id} ${call.title}` }),
              el.Box({ key: `${key}-${call.id}-options`, flexDirection: 'row', flexWrap: 'wrap', gap: 2, children: [
                ...call.options.map(option => el.Button({ key: `decide-${record.key}-${call.id}-${option.letter}`, label: `${option.letter}: ${option.label}${option.isRecommended ? ' (recommended)' : ''}`, plain: true, onPress: () => actions.onDecide(record, call, option.letter) })),
                el.Button({ key: `decide-${record.key}-${call.id}-explain`, label: 'Explain', plain: true, dimColor: true, onPress: () => actions.onDecide(record, call, '') }),
              ] }),
            ] }),
          )
        : []),
      el.Box({ key: `${key}-acts`, flexDirection: 'row', flexWrap: 'wrap', gap: 2, marginTop: 1, children: [
        ...(next ? [el.Button({ key: `act-${record.key}-${next}`, label: ACTION_LABELS[next], variant: 'primary', onPress: () => actions.onAction(next, [record]) })] : []),
        ...rest.map(kind => el.Button({ key: `act-${record.key}-${kind}`, label: ACTION_LABELS[kind], plain: true, dimColor: true, onPress: () => actions.onAction(kind, [record]) })),
      ] }),
    ],
  })
}

// The ask box, over every view: a question to the model, and its answer while the board shows its cut.
/** @param {any} el @param {PaneModel} model @param {Actions} actions */
const askBox = (el, model, actions) => {
  const { asked } = model
  const said = asked.state === 'running' ? 'Reading the board…' : asked.state === 'ready' ? (asked.value?.answer ?? '') : asked.state === 'failed' ? `No answer: ${asked.error}` : ''
  return el.Box({ key: 'ask-box', flexDirection: 'column', width: '100%', marginTop: 1, children: [
    el.Input({ key: 'ask', label: 'Ask', placeholder: 'what is blocking combat? whose decisions are oldest?', value: asked.key, submitLabel: 'ask Sonnet', onSubmit: (/** @type {string} */ question) => actions.onAsk(question) }),
    ...(said ? [el.Box({ key: 'ask-said', flexDirection: 'row', gap: 2, children: [
      el.Box({ key: 'ask-said-words', flexGrow: 1, flexShrink: 1, children: [el.Text({ key: 'ask-said-text', color: asked.state === 'ready' ? undefined : QUIET, wrap: 'wrap', children: said })] }),
      ...(asked.state === 'running' ? [] : [el.Button({ key: 'ask-clear', label: 'Clear', hotkey: 'x', plain: true, dimColor: true, onPress: actions.onClearAsk })]),
    ] })] : []),
  ] })
}

// The brief and the board's own suggestions, each a press that acts or cuts the board.
/** @param {any} el @param {PaneModel} model @param {Actions} actions */
const briefSection = (el, model, actions) => {
  const { brief } = model
  const status = brief.state === 'running' ? 'Sonnet is reading the board…' : brief.state === 'failed' ? `No brief: ${brief.error}` : brief.state === 'ready' ? `Sonnet, ${ageText(brief.at, model.now) || 'just now'}` : ''
  const headline = brief.value?.headline ?? ''
  return section(el, 'brief', [
    el.Box({ key: 'brief-head', flexDirection: 'row', gap: 2, children: [
      label(el, 'brief-label', 'Suggested', Math.max(9, model.width - status.length - 8)),
      el.Button({ key: 'brief-again', label: '↻', hotkey: 'r', plain: true, dimColor: true, onPress: actions.onBriefAgain }),
      ...(status ? [el.Text({ key: 'brief-status', color: QUIET, wrap: 'truncate', children: status })] : []),
    ] }),
    ...(headline ? [el.Text({ key: 'brief-headline', wrap: 'wrap', children: headline })] : []),
    ...model.suggestions.map(one =>
      el.Box({ key: `suggest-${one.key}`, flexDirection: 'column', children: [
        el.Button({ key: `suggest-${one.key}-press`, label: `› ${one.title}`, plain: true, onPress: () => actions.onSuggestion(one) }),
        ...(one.why ? [el.Text({ key: `suggest-${one.key}-why`, color: QUIET, wrap: 'wrap', children: `  ${one.why}` })] : []),
      ] }),
    ),
    ...(model.suggestions.length === 0 && brief.state !== 'running' ? [el.Text({ key: 'brief-none', color: QUIET, children: 'Nothing to suggest right now.' })] : []),
  ])
}

// A top-level label over its groups, with no blank line between them.
/** @param {any} el @param {PaneModel} model @param {Actions} actions @param {Extract<Section, { kind: 'label' }>} part @param {Columns} cols */
const labelSection = (el, model, actions, part, cols) =>
  section(el, part.key, [
    withMeta(el, `${part.key}-head`, label(el, `${part.key}-label`, part.title, model.width - part.meta.length - 2, part.isLoud ? LIME : undefined), part.meta),
    ...part.groups.map(group => el.Box({ key: group.key, flexDirection: 'column', width: '100%', children: groupLines(el, model, actions, group, cols) })),
  ])

// People or Areas: a line each; pressing one opens the table of its intents.
/** @param {any} el @param {Actions} actions @param {Extract<Section, { kind: 'lines' }>} part */
const lineSection = (el, actions, part) => {
  const width = Math.min(28, Math.max(4, ...part.lines.map(line => line.title.length)))
  return section(el, part.key, part.lines.map(line =>
    el.Box({
      key: `${part.key}-${line.key}`,
      flexDirection: 'row',
      gap: 2,
      children: [
        el.Box({ key: `${part.key}-${line.key}-name`, width, flexShrink: 0, children: [el.Button({ key: `${part.key}-${line.key}-press`, label: fit(line.title, width), plain: true, onPress: () => actions.onPick(part.by, line.key) })] }),
        el.Text({ key: `${part.key}-${line.key}-words`, color: QUIET, wrap: 'truncate', children: line.words }),
        ...(line.warn ? [el.Text({ key: `${part.key}-${line.key}-warn`, color: AMBER, wrap: 'truncate', children: line.warn })] : []),
      ],
    }),
  ))
}

// The search field, the pickers, and the toggles of the view in hand.
/** @param {any} el @param {PaneModel} model @param {Actions} actions */
const filters = (el, model, actions) => {
  const { filter, view } = model.look
  const all = choices(model.records)
  /** @param {string} key @param {string} text @param {readonly string[]} values @param {string} current @param {(value: string) => void} onSelect @param {(value: string) => string} [name] */
  const pick = (key, text, values, current, onSelect, name = value => value) =>
    el.Select({ key, label: text, value: current, options: [{ key: `${key}-any`, value: '', label: 'any' }, ...values.map(value => ({ key: `${key}-${value}`, value, label: name(value) }))], onSelect })
  const toggles = [
    ...(view === 'table' ? [el.Button({ key: 'sort', label: `Sort: ${SORTS[model.look.sort]}`, hotkey: 's', plain: true, onPress: actions.onSort }), el.Button({ key: 'group', label: `Group: ${GROUPS[model.look.group]}`, hotkey: 'g', plain: true, onPress: actions.onGroup })] : []),
    ...(view === 'items' ? [el.Button({ key: 'by', label: `By ${model.look.by}`, hotkey: 'g', plain: true, onPress: actions.onBy })] : []),
    ...(view === 'table' ? [el.Button({ key: 'done', label: filter.showDone ? 'Done shown' : 'Done hidden', hotkey: 'd', plain: true, dimColor: !filter.showDone, onPress: () => actions.onFilter({ showDone: !filter.showDone }) })] : []),
  ]
  return el.Box({
    key: 'filters',
    flexDirection: 'column',
    width: '100%',
    marginTop: 1,
    children: [
      el.Input({ key: 'words', label: 'Search', placeholder: 'words from a name, title, area or owner', value: filter.words, onInput: (/** @type {string} */ words) => actions.onFilter({ words }), onSubmit: (/** @type {string} */ words) => actions.onFilter({ words }) }),
      el.Box({
        key: 'pickers',
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 2,
        children: [
          pick('area', 'Area', all.areas, filter.area, area => actions.onFilter({ area })),
          pick('owner', 'Owner', all.owners, filter.owner, owner => actions.onFilter({ owner })),
          pick('stage', 'Stage', STAGES.map(stage => stage.key), filter.stage, stage => actions.onFilter({ stage }), key => STAGES.find(stage => stage.key === key)?.label ?? key),
          ...toggles,
        ],
      }),
    ],
  })
}

/** @param {any} el @param {PaneModel} model @param {Actions} actions */
export const boardPane = (el, model, actions) => {
  const { look } = model
  const { shown: records, parts, extras } = paneView(model.records, look, { me: model.me, modules: model.modules, mapping: model.mapped.value.mapping, now: model.now })
  const { mapped } = model
  const mapStatus = mapped.state === 'running' ? `Sonnet is mapping ${mapped.value.missing} intents onto the modules\u2026` : mapped.state === 'failed' ? `Mapping stopped: ${mapped.error}` : ''
  const groups = parts.flatMap(part => (part.kind === 'label' ? part.groups : part.kind === 'intents' ? [part] : []))
  const cols = rowColumns(groups.flatMap(group => group.rows.slice(0, ROW_CAP).map(one => cellsOf(model, group, one))), model.width < 90 ? 12 : 22)
  return el.Box({
    flexDirection: 'column',
    width: '100%',
    children: [
      label(el, 'title', model.title, model.width),
      statusLine(el, { text: summaryText(model.records, model.now), fresh: model.fresh, width: model.width, hotkey: 'f', onPress: actions.onSync, error: model.error }),
      el.Box({
        key: 'tabs',
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 2,
        marginTop: 1,
        children: [
          ...PANE_VIEWS.map((view, index) => el.Button({ key: `tab-${view}`, label: VIEW_LABELS[view], hotkey: String(index + 1), plain: true, dimColor: view !== look.view, onPress: actions.onView(view) })),
          // The views, then apart from them what acts beyond the pane.
          el.Text({ key: 'tabs-apart', color: QUIET, children: '│' }),
          el.Button({ key: 'open-page', label: 'Open the page', hotkey: 'o', plain: true, dimColor: true, onPress: actions.onOpenPage }),
          el.Button({ key: 'publish', label: 'Publish', hotkey: 'p', plain: true, dimColor: true, onPress: actions.onPublish }),
        ],
      }),
      askBox(el, model, actions),
      ...(extras.filters ? [filters(el, model, actions)] : []),
      ...(model.note ? [el.Text({ key: 'note', color: QUIET, wrap: 'wrap', children: model.note })] : []),
      ...(records.length !== model.records.length ? [el.Text({ key: 'shown', color: QUIET, children: `${records.length} of ${model.records.length} shown` })] : []),
      ...(extras.brief ? [briefSection(el, model, actions)] : []),
      ...(extras.mapping && mapStatus ? [el.Box({ key: 'map-status', flexDirection: 'row', gap: 2, marginTop: 1, children: [el.Text({ key: 'map-status-text', color: QUIET, wrap: 'wrap', children: mapStatus }), el.Button({ key: 'map-again', label: '\u21bb', plain: true, dimColor: true, onPress: actions.onMapAgain })] })] : []),
      ...parts.map(part => (part.kind === 'label' ? labelSection(el, model, actions, part, cols) : part.kind === 'lines' ? lineSection(el, actions, part) : section(el, part.key, groupLines(el, model, actions, part, cols)))),
      el.Text({ key: 'legend', color: QUIET, wrap: 'wrap', children: `${STAGES.map(stage => `${stage.glyph} ${stage.label}`).join('  ')}  ·  bar: ${'▰'.repeat(BAR_CELLS)} items met` }),
    ],
  })
}
