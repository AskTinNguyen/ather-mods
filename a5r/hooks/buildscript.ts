// A109 (rev 36): the sync's build starts from a script A5R writes, never from a command line the worker composes. MEASURED
// 2026-10-20 (sync 16:50): the worker ran `Start-Process cmd.exe -ArgumentList '/c "…\Build.bat" S2Editor … > "…build.log"
// 2>&1'`; cmd /c strips the first and last quote of a line that starts with a quote and holds more than two, so cmd exited
// at once, no log was written and no build ran. The holder's A5R writes `Saved/A5R/<sync id>-build.cmd` before it starts
// the worker of a build sync, and the worker's task gives the one PowerShell command that starts it. A110 (rev 37): the
// engine root is always written into the script, found by A5R (machine.ts); with none found no script is written. Pure: no `$`.
import { psQuote } from './a5r.ts'

/** The script's own last line in the log: its exit code after Build.bat, or why it refused to run Build.bat. Build.bat
 * exits 0 on failure, so only the build's own `Result:` line says how it went; this line only says that the script ended. */
export const SCRIPT_END = /^A5R build (exit|refused)\b/m
/** Build.bat's own line while another Build.bat on the same engine holds its lock (MEASURED, Fable review of rev 36: the
 * second script runs only cmd and ping, no dotnet or UnrealBuildTool, until the first ends): started, and queued. */
export const LOCK_WAIT = /waiting for existing script to terminate/i

/** The sync's build script, beside its log (syncstage.ts `syncBuildLog`): one file per sync, written fresh before each
 * worker start; the probe lists a cmd.exe whose command line holds this suffix (coord.ts `ramProbe`). */
export const SCRIPT_SUFFIX = '-build.cmd'
export const syncBuildScript = (checkout: string, syncId: string): string => `${checkout}/Saved/A5R/${syncId}${SCRIPT_SUFFIX}`
/** The script's own cmd.exe runs (null: no process list was read, never taken for gone). Another lane's dotnet, cl or Live
 * Coding never counts as this sync's build. */
export const isScriptAlive = (procs: readonly { name: string; cmd?: string }[] | null, syncId: string): boolean | null =>
  procs === null ? null : procs.some(p => /^cmd$/i.test(p.name) && (p.cmd ?? '').toLowerCase().includes(`${syncId}${SCRIPT_SUFFIX}`.toLowerCase()))

const win = (p: string): string => p.trim().replace(/\//g, '\\').replace(/\\+$/, '')
/** A literal for `set "NAME=…"`: inside the quotes `&`, `(`, `)` and spaces are plain text; only `%` needs doubling. */
const lit = (p: string): string => win(p).replace(/%/g, '%%')
/** `call` expands `%` once more and doubles `^` even inside quotes (MEASURED 2026-10-20: `p%x^y` reached Build.bat as
 * `px^^y`), so a checkout or engine root with either is refused in the log rather than built with a broken path. */
const isCallSafe = (p: string): boolean => !/[%^]/.test(p)

/** The text of the sync's build script (CRLF): the engine root A5R found (A110) written in; Build.bat for the project's
 * editor target (`<project>Editor`, Unreal's naming: S2Editor for S2.uproject) Win64 Development with the checkout's
 * .uproject and -WaitMutex, its output and errors written fresh with `>` to the log; then the script's own exit line
 * appended. With no Build.bat under the root it writes one refusal line to the log and exits 2. */
export const buildScriptText = (checkout: string, uproject: string, log: string, engineRoot: string): string => {
  const root = engineRoot.trim()
  const lines = [
    '@echo off',
    `rem A5R (A109): the sync's build. Written by A5R before the sync worker starts; started by the worker's one command.`,
    'setlocal DisableDelayedExpansion',
    `set "LOG=${lit(log)}"`,
    `set "PROJECT=${lit(`${checkout}/${uproject}`)}"`,
    `set "ROOT=${lit(root)}"`,
    'set "BAT=%ROOT%\\Engine\\Build\\BatchFiles\\Build.bat"',
    'if not exist "%BAT%" goto nobat',
    ...(isCallSafe(`${checkout}/${uproject}`) && isCallSafe(root) ? [] : ['goto badpath']),
    `call "%BAT%" ${uproject.replace(/\.uproject$/i, '')}Editor Win64 Development -Project="%PROJECT%" -WaitMutex > "%LOG%" 2>&1`,
    '>> "%LOG%" echo A5R build exit %ERRORLEVEL% (engine "%ROOT%")',
    'exit /b %ERRORLEVEL%',
    ':nobat',
    '> "%LOG%" echo A5R build refused: "%BAT%" does not exist (not an engine root)',
    'exit /b 2',
    ':badpath',
    '> "%LOG%" echo A5R build refused: the checkout or engine root holds a percent sign or a caret, which call would change; build by hand',
    'exit /b 2',
  ]
  return `${lines.join('\r\n')}\r\n`
}

/** The one PowerShell command that starts the script, detached and hidden (Start-Process on a .cmd hands it to cmd with
 * its path quoted: a path with spaces or `&` runs as is, tested in tests/rev36.test.ts). */
export const buildStartCommand = (script: string): string => `Start-Process -FilePath ${psQuote(win(script))} -WindowStyle Hidden`

/** The start command as the worker's task and the holder's notices give it. */
export const runLabel = (run: string): string => `this one PowerShell command: ${run}`

/** How a notice tells the holder to build: the sync's script with its one command, or, when no script was written (A5R
 * found no engine root, A110, or could not write it), how to build by hand (in a script of the holder's own: a `cmd /c`
 * line with quotes breaks, L-40). */
export const buildStep = (run: string): string =>
  run ? `its script, ${runLabel(run)}` : '<engine root>\\Engine\\Build\\BatchFiles\\Build.bat <project>Editor Win64 Development -Project="<checkout>\\<project>.uproject" -WaitMutex, its output and errors written fresh to the build log with > (from a .cmd script, never a cmd /c line); A5R wrote no build script (the worker\'s task says why): when it found no engine root, set the a5r option engineRoot to the engine root that builds this checkout'
