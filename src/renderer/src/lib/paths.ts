/**
 * Slash- and case-insensitive path equality for display logic — git prints
 * forward slashes where node prints backslashes on Windows, and the renderer
 * has no node:path to normalize with.
 */
export function samePathIsh(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return norm(a) === norm(b)
}
