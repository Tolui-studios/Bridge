/**
 * Parsing for BRIDGE:CLAIM payloads — the comma/whitespace-separated list of
 * repo-relative files an agent declares it intends to edit. Claims are soft
 * coordination (steering, never locks): they surface in other launches'
 * footers and the worktree overlap panel, and die with the session.
 * Renderer-safe: no node imports.
 */

/** Per-marker cap — a claim list is a handful of hot files, not a manifest. */
const MAX_CLAIM_PATHS = 32
/** Total cap per session, so a runaway agent can't grow claims unbounded. */
const MAX_TOTAL_CLAIMS = 128
const MAX_PATH_LENGTH = 260

/**
 * Split a CLAIM payload into normalized repo-relative paths: forward slashes,
 * no leading `./`, deduped case-insensitively keeping the first spelling.
 * Absolute paths and `..` segments are dropped — a claim must stay inside the
 * repo. Never throws; garbage in, fewer paths out.
 */
export function parseClaimPaths(payload: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of payload.split(/[,\s]+/)) {
    let p = raw.trim().replace(/\\/g, '/')
    while (p.startsWith('./')) p = p.slice(2)
    if (!p || p.length > MAX_PATH_LENGTH) continue
    // Repo-relative only: no absolute paths (POSIX or drive-lettered), no escapes.
    if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) continue
    if (p.split('/').some((segment) => segment === '..')) continue
    const key = p.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
    if (out.length >= MAX_CLAIM_PATHS) break
  }
  return out
}

/**
 * Union newly claimed paths into a session's existing claims, case-insensitive
 * on the path, keeping first-seen spelling and order. Capped so repeated
 * claiming can't grow without bound.
 */
export function unionClaims(existing: string[], added: string[]): string[] {
  const out = [...existing]
  const seen = new Set(existing.map((p) => p.toLowerCase()))
  for (const p of added) {
    if (out.length >= MAX_TOTAL_CLAIMS) break
    const key = p.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}
