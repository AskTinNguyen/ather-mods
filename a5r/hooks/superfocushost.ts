// Intent a5r-superfocus, the host side on closures (no `$`: register.ts hands it the engine's calls and its own
// personCommand / personChange, so a Super Focus change is checked, serialized and logged like every other change of the
// person's). The person's /a5r superfocus: superfocus.json and a choice's Focus written together, then the park messages
// and this session's prompt; the superfocus tool: a listed session's own `parked` report, or `status`. The rules are
// superfocus.ts's.
import { hhmm, noticeText } from './coord.ts'
import type { Focus } from './focus.ts'
import type { PersonChange } from './hostio.ts'
import type { Parsed } from './order.ts'
import { SUPERFOCUS_GATE, applyParked, parseSuperFocus, parseSuperFocusCommand, planSuperFocus, showSuperFocus, type SfAction, type SfResult, type SfWorld } from './superfocus.ts'

export type SfIo = {
  read: () => Promise<string | null>
  /** read-compare-write against `expected` */
  write: (expected: string | null, text: string) => Promise<{ isWritten: boolean }>
  send: (session: string, text: string) => Promise<boolean>
  prompt: (text: string) => Promise<void>
  now: () => Promise<number>
  me8: () => string
}
export type SfCommandIo = SfIo & {
  writeFocus: (f: Focus) => Promise<boolean>
  /** the world as personChange read it fresh */
  world: (now: number) => SfWorld
  focus: () => Focus | null
  by: () => string
  /** register.ts personCommand: the usage, the person's origin, then `act`; `show` for no words */
  personCommand: (c: Parsed<SfAction>, act: (a: SfAction) => Promise<string>, show: () => Promise<string>) => Promise<string>
  /** register.ts personChange: A5R on, the checkout, the world read fresh, one change at a time, logged */
  personChange: (plan: (now: number) => Promise<PersonChange>) => Promise<string>
}

/** `/a5r superfocus …`: what runs, or the person's start, choice, restore or cancel. */
export const superFocusCommand = (io: SfCommandIo, args: string): Promise<string> =>
  io.personCommand(parseSuperFocusCommand(args), a => io.personChange(now => superFocusChange(io, a, now)), async () => showSuperFocus(parseSuperFocus(await io.read())))

/** One change of the person's, planned on superfocus.json read inside personChange's turn: the file first, then a choice's
 * Focus; a Focus that cannot be written puts the file back, and a file that cannot be put back is said, not hidden. */
export async function superFocusChange(io: SfCommandIo, a: SfAction, now: number): Promise<PersonChange> {
  const raw = await io.read()
  const p = planSuperFocus(parseSuperFocus(raw), io.world(now), io.focus(), a, io.by())
  if ('refusal' in p) return p
  const text = JSON.stringify(p.r.sf)
  const write = async (): Promise<boolean | string> => {
    if (!(await io.write(raw, text)).isWritten) return false
    if (!p.focus || (await io.writeFocus(p.focus))) return true
    // a choice always has a file to put back: it needs a parking one
    return (await io.write(text, raw ?? '')).isWritten ? false : noticeText(SUPERFOCUS_GATE, 'superfocus.json names a focus session, but its Focus could not be written and the file could not be put back', 'run /a5r superfocus cancel, then start again')
  }
  const note = p.focus ? `${p.r.text}; Focus given to ${p.focus.id8} until ${hhmm(p.focus.endsAt)}` : p.r.text
  return { write, after: () => afterChange(io, p.r), what: 'superfocus.json', rule: 'superfocus', note, text: p.r.text, next: '/a5r superfocus shows every session' }
}

/** After the person's written change: each park message sent, then this session's prompt; the sessions a message did not
 * reach named ('' when every one did). */
async function afterChange(io: SfIo, r: Exclude<SfResult, { refusal: string }>): Promise<string> {
  const sent = await Promise.all(r.sends.map(s => io.send(s.session, s.text).catch(() => false)))
  const missed = r.sends.filter((_, i) => !sent[i]).map(s => s.session.slice(0, 8))
  if (r.prompt) await io.prompt(r.prompt)
  return missed.length ? noticeText(SUPERFOCUS_GATE, `the park message did not reach ${missed.join(', ')}`, 'open those sessions so they read it, or choose with ! to keep them as they are') : ''
}

/** The superfocus tool: a listed session's own `parked` report, or `status`. */
export async function superFocusTool(io: SfIo, input: { action: string; branch: string; sha: string; note: string }): Promise<string> {
  const raw = await io.read()
  if (input.action === 'status') return showSuperFocus(parseSuperFocus(raw))
  if (input.action !== 'parked') return noticeText(SUPERFOCUS_GATE, `"${input.action}" is no action of the superfocus tool`, 'call it with action parked or status')
  const r = applyParked(parseSuperFocus(raw), io.me8(), input, await io.now())
  if ('refusal' in r) return r.refusal
  return (await io.write(raw, JSON.stringify(r.sf))).isWritten ? noticeText(SUPERFOCUS_GATE, r.text, 'stay idle') : noticeText(SUPERFOCUS_GATE, 'superfocus.json changed at the same moment (another session reported)', 'call parked again')
}
