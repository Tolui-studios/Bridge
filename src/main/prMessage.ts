/**
 * Title/body building for the PRs Bridge opens from agent worktrees — pure
 * and vitest-covered. Every PR gets a written message: title from the
 * session's task (or the branch's first meaningful commit), body with the
 * task, the commit list, and the agent's Studio test steps. gh's --fill is
 * never used — it would title the PR after whatever commit happens to be
 * last, usually the auto-generated "chore: … work in progress".
 */

export interface PrMessage {
  title: string
  body: string
}

export interface PrFacts {
  branch: string
  /** The task the session was launched with, when the session is known. */
  task?: string | null
  /** BRIDGE:TEST steps the agent left to verify in Studio. */
  testSteps?: string[]
  /** Commit subjects on the branch (newest first), base..branch. */
  commits?: string[]
  /** `git diff --shortstat base...branch`, e.g. "4 files changed, 120 insertions(+)". */
  diffstat?: string | null
}

const TITLE_MAX = 72
const COMMITS_MAX = 15
/** Auto-generated subjects that say nothing — never promote these to a title. */
const NOISE_SUBJECT = /work in progress|^wip\b|^merge\b/i

/** Cut at a word boundary so a long title never ends mid-word. */
function truncateTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim()
  if (clean.length <= TITLE_MAX) return clean
  const cut = clean.slice(0, TITLE_MAX - 1)
  const atWord = cut.includes(' ') ? cut.slice(0, cut.lastIndexOf(' ')) : cut
  return `${atWord}…`
}

/** First non-empty line of the task as a PR/commit subject; null when blank. */
export function titleFromTask(task: string | null | undefined): string | null {
  const line = (task ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  return line ? truncateTitle(line) : null
}

export function buildPrMessage(facts: PrFacts): PrMessage {
  const commits = (facts.commits ?? []).map((s) => s.trim()).filter(Boolean)
  const meaningful = commits.filter((s) => !NOISE_SUBJECT.test(s))
  const title =
    titleFromTask(facts.task) ??
    (meaningful[0] ? truncateTitle(meaningful[0]) : `Changes from ${facts.branch}`)

  const lines: string[] = []
  const task = facts.task?.trim()
  if (task) lines.push('## Task', task, '')
  if (commits.length > 0) {
    const shown = commits.slice(0, COMMITS_MAX)
    lines.push('## Commits', ...shown.map((s) => `- ${s}`))
    if (commits.length > shown.length) lines.push(`- …and ${commits.length - shown.length} more`)
    lines.push('')
  }
  const steps = facts.testSteps ?? []
  if (steps.length > 0) {
    lines.push('## How to test in Studio', ...steps.map((s) => `- [ ] ${s}`), '')
  }
  const stat = facts.diffstat?.trim()
  lines.push(`_Opened by Bridge from \`${facts.branch}\`${stat ? ` — ${stat}` : ''}._`)

  return { title, body: lines.join('\n') }
}
