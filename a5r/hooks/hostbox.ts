// a5r-hosts D17 (S-b): the Hosts tile, drawn from rows hostdesk.ts computes: one row per host, then S-a's hand-off rows
// under it. Only with a host declared or a hand-off open (the caller decides). Pure: no `$`.
import { handoffBox } from './handoffhost.ts'
import type { Handoff } from './handoff.ts'
import { STATUS, V2 } from './theme.ts'

type El = { Box: (p: Record<string, unknown>) => unknown; Text: (p: Record<string, unknown>) => unknown }
/** One host's row: what it says, and its dot (ok: L1 or more; warn: L0; bad: storm or invalid). */
export type HostRow = { id: string; text: string; dot: 'ok' | 'warn' | 'bad' }

/** `states`: each open L2 hand-off's effective state (S-d); `waiting`: this host's accepted jobs that wait for a session. */
export const hostsBox = (el: El, rows: readonly HostRow[], open: readonly Handoff[], now: number, look: { ink: string; quiet: string }, states: ReadonlyMap<string, string> = new Map(), waiting: readonly string[] = []): unknown =>
  el.Box({
    key: 'hai-hosts',
    flexDirection: 'column',
    width: '100%',
    marginTop: 1,
    children: [
      ...(rows.length ? [el.Box({ key: 'hai-hosts-head', children: [el.Text({ color: V2.label, children: `HOSTS · ${rows.length}` })] })] : []),
      ...rows.map(r =>
        el.Box({
          key: `hai-host-${r.id}`,
          flexDirection: 'row',
          width: '100%',
          columnGap: 1,
          children: [
            el.Box({ key: `hai-host-${r.id}-dot`, flexShrink: 0, children: [el.Text({ color: STATUS[r.dot], children: '●' })] }),
            el.Box({ key: `hai-host-${r.id}-what`, flexShrink: 1, flexGrow: 1, minWidth: 0, children: [el.Text({ color: look.ink, wrap: 'truncate-end', children: r.text })] }),
          ],
        }),
      ),
      ...waiting.map(w => el.Box({ key: `hai-host-wait-${w}`, children: [el.Text({ color: STATUS.warn, wrap: 'truncate-end', children: w })] })),
      ...(open.length ? [handoffBox(el, open, now, look, states)] : []),
    ],
  })
