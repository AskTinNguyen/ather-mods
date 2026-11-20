// Rev 44: the engine's file reads and writes for one call, as the hosts on closures take them (gitturnhost.ts,
// freezehost.ts); register.ts builds them over that call's engine. Types only.
export type FileIo = {
  now: () => Promise<number>
  read: (path: string) => Promise<string | null>
  write: (path: string, text: string) => Promise<void>
  stat: (path: string) => Promise<{ mtimeMs: number } | null>
  list: (dir: string) => Promise<{ name: string; mtimeMs: number }[]>
  run: (argv: string[], timeoutMs: number) => Promise<{ exitCode: number; stdout: string } | null>
}

/** A117 / A118 / intent a5r-superfocus: one change of the person's as register.ts personChange makes it: `write` is true once
 * written, false on a race, or its own refusal text when it is more than a race; `after` runs once the change is written,
 * logged and the Editor's queue let go (its text joins the reply). */
export type PersonChange = { refusal: string } | { write: () => Promise<boolean | string>; after?: () => Promise<string>; what: string; rule: 'manual' | 'focus' | 'superfocus'; note: string; text: string; next: string }
