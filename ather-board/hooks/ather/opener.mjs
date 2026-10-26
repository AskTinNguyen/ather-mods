// @ts-check
// Ather Automata: opening a file or a link with the system's own handler, for every plugin that opens one (Ather
// Board's page, Needs you's Go to session). Pure: the command runs through a closure built where `$` lives, and the
// caller says whether the host is Windows (the engine names no platform; each caller has its own sign of it).

/**
 * Runs an argument vector (no shell) and resolves its exit code; it may reject when the command cannot start.
 * @typedef {(argv: readonly string[]) => Promise<{ exitCode: number }>} Run
 */

// cmd reads these inside `start`'s argument too: a target carrying one is not handed to it.
const CMD_SPECIAL = /["%^&|<>\r\n]/

// Whether `start` may be handed `target`: it carries nothing cmd would read as more than one argument or command.
/** @param {string} target */
export const isStartable = target => !CMD_SPECIAL.test(target)

// The commands that open `target`, tried in order: `start` through cmd on Windows, else `open` (macOS), then `xdg-open`.
/** @param {string} target @param {boolean} isWindows @returns {string[][]} */
export const openerTries = (target, isWindows) => {
  if (isWindows) return isStartable(target) ? [['cmd', '/c', 'start', '', target]] : []
  return [['open', target], ['xdg-open', target]]
}

// Whether one of them opened it (exit code 0). Never rejects: a command that cannot start (a rejection or a throw) is the
// next one's turn.
/** @param {Run} run @param {string} target @param {boolean} isWindows */
export const openWith = async (run, target, isWindows) => {
  for (const argv of openerTries(target, isWindows)) {
    const ran = await Promise.resolve()
      .then(() => run(argv))
      .catch(() => undefined)
    if (ran?.exitCode === 0) return true
  }
  return false
}
