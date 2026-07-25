import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * Open a folder in VS Code. `code` is a `.cmd` shim on Windows (so it needs a
 * shell), and on macOS it only exists once the user has run "Shell Command:
 * Install 'code' command in PATH" — hence the `open -a` fallback there.
 *
 * `--disable-workspace-trust` skips the trust prompt, which would otherwise
 * appear for every freshly created `agent-<n>` directory. It affects only the
 * launched session, never the user's global trust settings — and a worktree is
 * a checkout of a repo they already own.
 */
export async function openInVsCode(dir: string): Promise<void> {
  const flag = '--disable-workspace-trust'
  const attempts: [string, string[]][] =
    process.platform === 'win32'
      ? [['cmd', ['/c', 'code', flag, dir]]]
      : process.platform === 'darwin'
        ? [
            ['code', [flag, dir]],
            ['open', ['-a', 'Visual Studio Code', '--args', flag, dir]]
          ]
        : [['code', [flag, dir]]]

  let lastError: unknown = null
  for (const [command, args] of attempts) {
    try {
      await execFileAsync(command, args, { windowsHide: true })
      return
    } catch (err) {
      lastError = err
    }
  }
  const detail = lastError instanceof Error ? ` (${lastError.message.trim().slice(0, 120)})` : ''
  throw new Error(
    `Could not launch VS Code. Install it, then run "Shell Command: Install 'code' command in PATH" from its Command Palette so \`code\` is available.${detail}`
  )
}
