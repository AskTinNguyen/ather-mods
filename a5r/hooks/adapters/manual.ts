// a5r-hosts S-b: the `manual` adapter (scenario 7: no transport). It has no ops: every call answers NO_ADAPTER_OP. What
// it gives instead is the steps a person runs on the host and a reader for the lines they paste back
// (`/a5r host check <id> --paste <file>`). Pure.
import { DEFAULT_LINK, type Adapter, type RemoteOs } from './types.ts'

export const manualAdapter = (): Adapter => ({ kind: 'manual', link: DEFAULT_LINK, helpers: () => null })

/** What a person runs on the host, by its OS, so its output can be pasted back: each line starts with its tag. */
export const MANUAL_STEPS: Record<RemoteOs, string> = {
  windows: `echo a5r-os %OS% & powershell -NoProfile -Command "'a5r-epoch ' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); $o=Get-CimInstance Win32_OperatingSystem; 'a5r-ram ' + $o.TotalVisibleMemorySize + ' ' + $o.FreePhysicalMemory"`,
  posix: `echo "a5r-os $(uname -s)"; echo "a5r-epoch $(date +%s)000"; awk '/MemTotal/{t=$2}/MemAvailable/{f=$2}END{print "a5r-ram",t,f}' /proc/meminfo`,
}

export const manualPacket = (id: string, label: string): string =>
  [
    `Host ${id} (${label}) has no transport: run this on it and save the whole output to a file on this machine.`,
    `  Windows (cmd): ${MANUAL_STEPS.windows}`,
    `  Linux or macOS (sh): ${MANUAL_STEPS.posix}`,
    `Then: /a5r host check ${id} --paste <that file>. The pasted lines fill C1 (OS), C4 (clock) and C10 (RAM); C2 and C5 need a link and stay skipped, so a manual host stays at L0.`,
  ].join('\n')

/** The pasted lines read: the OS, the host's clock (ms), RAM in KB; a field not pasted is null. */
export type Pasted = { os: RemoteOs | null; osText: string | null; epochMs: number | null; ramKb: { total: number; free: number | null } | null }
export const parsePaste = (text: string): Pasted => {
  const tag = (t: string) => text.split(/\r?\n/).map(l => l.trim()).find(l => l.startsWith(`${t} `))?.slice(t.length + 1).trim() ?? null
  const os = tag('a5r-os')
  const epoch = Number(tag('a5r-epoch'))
  const [total, free] = (tag('a5r-ram') ?? '').split(/\s+/).map(Number)
  return {
    os: os === null ? null : /windows/i.test(os) ? 'windows' : 'posix',
    osText: os,
    epochMs: Number.isFinite(epoch) && epoch > 0 ? epoch : null,
    ramKb: total && Number.isFinite(total) ? { total, free: free !== undefined && Number.isFinite(free) ? free : null } : null,
  }
}
