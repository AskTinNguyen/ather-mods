// A109 (rev 36): the sync's build starts from a script A5R writes, never from a command line the worker composes. MEASURED
// 2026-10-20 (sync 16:50): the worker ran `Start-Process cmd.exe -ArgumentList '/c "…\Build.bat" S2Editor … > "…build.log"
// 2>&1'`; cmd /c strips the first and last quote of a line that starts with a quote and holds more than two, so cmd exited
// at once, no log was written and no build ran. The holder's A5R writes `Saved/A5R/<sync id>-build.cmd` before it starts
// the worker of a build sync, and the worker's task gives the one PowerShell command that starts it. Pure: no `$`.
import { psQuote } from './a5r.ts'

/** Where the worker puts the engine root from the machine profile in the start command when the option is unset. */
export const ENGINE_ROOT_SLOT = '<engine root>'
/** The script's own last line in the log: its exit code after Build.bat, or why it refused to run Build.bat. Build.bat
 * exits 0 on failure, so only the build's own `Result:` line says how it went; this line only says that the script ended. */
export const SCRIPT_END = /^A5R build (exit|refused)\b/m

/** The sync's build script, beside its log (syncstage.ts `syncBuildLog`): one file per sync, written fresh before each
 * worker start. */
export const syncBuildScript = (checkout: string, syncId: string): string => `${checkout}/Saved/A5R/${syncId}-build.cmd`

const win = (p: string): string => p.trim().replace(/\//g, '\\').replace(/\\+$/, '')
/** A literal for `set "NAME=…"`: inside the quotes `&`, `(`, `)` and spaces are plain text; only `%` needs doubling. */
const lit = (p: string): string => win(p).replace(/%/g, '%%')
/** `call` expands `%` once more and doubles `^` even inside quotes (MEASURED 2026-10-20: `p%x^y` reached Build.bat as
 * `px^^y`), so a checkout or engine root option with either is refused in the log rather than built with a broken path
 * (a root passed as the argument is not checked: call then fails to find Build.bat and the script's exit line follows). */
const isCallSafe = (p: string): boolean => !/[%^]/.test(p)

/** The text of the sync's build script (CRLF): the engine root from the option `engineRoot` when set, else from its first
 * argument; Build.bat for S2Editor Win64 Development with the checkout's S2.uproject and -WaitMutex, its output and errors
 * written fresh with `>` to the log; then the script's own exit line appended. With no root, or no Build.bat under it, it
 * writes one refusal line to the log and exits 2. */
export const buildScriptText = (checkout: string, log: string, engineRoot = ''): string => {
  const root = engineRoot.trim()
  const lines = [
    '@echo off',
    `rem A5R (A109): the sync's build. Written by A5R before the sync worker starts; started by the worker's one command.`,
    'setlocal DisableDelayedExpansion',
    `set "LOG=${lit(log)}"`,
    `set "PROJECT=${lit(`${checkout}/S2.uproject`)}"`,
    root ? `set "ROOT=${lit(root)}"` : 'set "ROOT=%~1"',
    'if not defined ROOT goto noroot',
    'if "%ROOT:~-1%"=="\\" set "ROOT=%ROOT:~0,-1%"',
    'set "BAT=%ROOT%\\Engine\\Build\\BatchFiles\\Build.bat"',
    'if not exist "%BAT%" goto nobat',
    ...(isCallSafe(checkout) && isCallSafe(root) ? [] : ['goto badpath']),
    'call "%BAT%" S2Editor Win64 Development -Project="%PROJECT%" -WaitMutex > "%LOG%" 2>&1',
    '>> "%LOG%" echo A5R build exit %ERRORLEVEL% (engine "%ROOT%")',
    'exit /b %ERRORLEVEL%',
    ':noroot',
    `> "%LOG%" echo A5R build refused: no engine root (set the a5r option engineRoot, or pass the engine root as the first argument)`,
    'exit /b 2',
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
 * its path quoted: a path with spaces or `&` runs as is, tested in tests/rev36.test.ts); the engine root as its first
 * argument when the option is unset. */
export const buildStartCommand = (script: string, engineRoot = ''): string =>
  `Start-Process -FilePath ${psQuote(win(script))}${engineRoot.trim() ? '' : ` -ArgumentList ${psQuote(`"${ENGINE_ROOT_SLOT}"`)}`} -WindowStyle Hidden`

/** The start command as the worker's task and the holder's notices give it. */
export const runLabel = (run: string): string =>
  `this one PowerShell command${run.includes(ENGINE_ROOT_SLOT) ? ` (put the engine root from the machine profile in place of ${ENGINE_ROOT_SLOT})` : ''}: ${run}`

/** How a notice tells the holder to build: the sync's script with its one command, or, when no script was written, what
 * the script would have run (in a script of the holder's own: a `cmd /c` line with quotes breaks, L-40). */
export const buildStep = (run: string): string =>
  run ? `its script, ${runLabel(run)}` : 'Build.bat S2Editor Win64 Development -Project="<checkout>\\S2.uproject" -WaitMutex, its output and errors written fresh to the build log with > (from a .cmd script, never a cmd /c line)'
