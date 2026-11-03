// Rev 44: the engine's file reads and writes for one call, as the hosts on closures take them (gitturnhost.ts,
// freezehost.ts); register.ts builds them over that call's engine. A type only.
export type FileIo = {
  now: () => Promise<number>
  read: (path: string) => Promise<string | null>
  write: (path: string, text: string) => Promise<void>
  stat: (path: string) => Promise<{ mtimeMs: number } | null>
  list: (dir: string) => Promise<{ name: string; mtimeMs: number }[]>
  run: (argv: string[], timeoutMs: number) => Promise<{ exitCode: number; stdout: string } | null>
}
