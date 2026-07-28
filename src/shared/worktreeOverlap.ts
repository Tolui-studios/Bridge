/**
 * Pure overlap detection between working trees: which files are touched by
 * two or more of them at once. Those files are merge conflicts in the making —
 * the whole point of the worktree panel is to surface them while both agents
 * are still running, not at PR-merge time.
 *
 * Renderer-safe: no node imports, no fs. Comparison is case- and
 * slash-insensitive (git prints `/`, Windows thinks in `\` and ignores case)
 * while the first-seen original spelling is kept for display.
 */

export interface OverlapSource {
  /** Stable identity for the tree: 'main' or the absolute worktree path. */
  key: string
  /** Repo-relative file paths, any slash style or casing. */
  files: string[]
}

export interface OverlapResult {
  /**
   * Normalized file path -> keys of every tree touching it. Only files with
   * two or more distinct holders appear. Insertion order = first-seen order.
   */
  byFile: Record<string, string[]>
  /** Tree key -> its conflicted files (normalized, first-seen order). */
  byKey: Record<string, string[]>
  /** Normalized path -> first-seen original spelling, for display. */
  display: Record<string, string>
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase()
}

export function computeOverlap(sources: OverlapSource[]): OverlapResult {
  const holders = new Map<string, string[]>()
  const display: Record<string, string> = {}

  for (const source of sources) {
    const seen = new Set<string>()
    for (const file of source.files) {
      const norm = normalizePath(file)
      // A tree can list one path twice (e.g. committed + uncommitted views);
      // it must never read as conflicting with itself.
      if (seen.has(norm)) continue
      seen.add(norm)
      if (!(norm in display)) display[norm] = file
      const list = holders.get(norm)
      if (list) list.push(source.key)
      else holders.set(norm, [source.key])
    }
  }

  const byFile: Record<string, string[]> = {}
  const byKey: Record<string, string[]> = {}
  for (const [file, keys] of holders) {
    if (keys.length < 2) continue
    byFile[file] = keys
    for (const key of keys) {
      ;(byKey[key] ??= []).push(file)
    }
  }
  return { byFile, byKey, display }
}
