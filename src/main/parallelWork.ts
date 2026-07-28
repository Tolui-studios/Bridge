/**
 * The "parallel work" section appended to a fresh agent launch: the
 * BRIDGE:CLAIM protocol, the pre-PR self-sync instruction, and — when other
 * sessions are live in the same repo — the files each has already changed or
 * claimed, so a new agent steers around merge conflicts instead of
 * discovering them at PR time. Pure and electron-free (goalSync.ts
 * precedent) so vitest covers it.
 */

/** What one OTHER live session of the game is touching. */
export interface ParallelWorkEntry {
  /** Short label for that session (worktree name + task snippet). */
  label: string
  /** Repo-relative files its worktree has already changed. */
  changedFiles: string[]
  /** Repo-relative files it declared via BRIDGE:CLAIM. */
  claims: string[]
}

const MAX_FILES_PER_ENTRY = 20

function capped(files: string[]): string {
  const shown = files.slice(0, MAX_FILES_PER_ENTRY)
  const more = files.length - shown.length
  return shown.join(', ') + (more > 0 ? ` (+${more} more)` : '')
}

/**
 * Always returns the claim protocol + self-sync instruction; prepends the
 * in-flight list only when another session is actually touching something.
 */
export function buildParallelWorkSection(
  entries: ParallelWorkEntry[],
  defaultBranch: string
): string {
  const lines = [
    '',
    'Parallel work: other Bridge agents may work in this repo at the same time, each',
    'on its own branch, merged later as separate PRs. As soon as you know which',
    'conflict-prone shared files you will edit (registries, barrels, config files,',
    'CLAUDE.md — not every file you touch), declare them on one line:',
    'BRIDGE:CLAIM <repo-relative paths, comma separated>',
    'Claims expire when your session ends.',
    'Before declaring the task done, run',
    `git fetch origin && git merge origin/${defaultBranch}`,
    'in your workspace and resolve any conflicts yourself — you have the context on',
    'your own change — then re-run your checks.'
  ]
  const active = entries.filter((e) => e.changedFiles.length + e.claims.length > 0)
  if (active.length > 0) {
    lines.push('', 'Files other active agents have already changed or claimed:')
    for (const entry of active) {
      const parts: string[] = []
      if (entry.changedFiles.length > 0) parts.push(capped(entry.changedFiles))
      if (entry.claims.length > 0) parts.push(`claimed: ${capped(entry.claims)}`)
      lines.push(`- ${entry.label}: ${parts.join('; ')}`)
    }
    lines.push(
      'Avoid editing these files. If your task genuinely requires one, prefer adding',
      'a new file or a self-contained section over editing existing lines, keep the',
      'edit minimal, and say so in your reply so the operator can sequence the merges.'
    )
  }
  return lines.join('\n')
}
