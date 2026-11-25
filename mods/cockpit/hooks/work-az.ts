
/** What `cmd` reads as text: letters, digits, spaces and the punctuation of a URL, a ref or a name (`&`, `|`, `%`, `^`, quotes and the like are left out). */
const CMD_SAFE = /^[\p{L}\p{N} _./@+=,:#-]*$/u

/**
 * The argument vector that runs the Azure CLI with `args`. `$.process.run` starts a command with no shell, and on Windows
 * the CLI is `az.cmd`, which cannot be started by name: it goes through `cmd /d /s /c`. Then an argument `cmd` would read
 * as more than text (a branch named `a&b`) is never handed to it: undefined, and the call is not made.
 */
export function azArgv(args: readonly string[], isWindows: boolean): string[] | undefined {
  if (!isWindows) return ['az', ...args]
  return args.every(a => CMD_SAFE.test(a)) ? ['cmd', '/d', '/s', '/c', 'az', ...args] : undefined
}
