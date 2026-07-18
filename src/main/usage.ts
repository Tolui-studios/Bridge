import { webContents } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk'
import { IPC } from '@shared/ipc-channels'
import type { UsageSnapshot, UsageWindow } from '@shared/types'

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const POLL_MS = 80_000
/** Never hit the API more often than this, no matter who asks. */
const MIN_FETCH_INTERVAL_MS = 15_000
/** After a 429, stop calling the API for this long and serve cached data. */
const RATE_LIMIT_COOLDOWN_MS = 5 * 60_000
/**
 * The endpoint rate-limits by User-Agent bucket: unidentified clients get a
 * tiny per-token budget (~5 requests) with a useless `retry-after: 0`, while
 * the official client UA gets a workable one. See claude-code issues
 * #30930 / #31021. Version string tracks the CLI bundled with our SDK.
 */
const USER_AGENT = 'claude-code/2.1.214'

const KIND_LABELS: Record<string, string> = {
  session: 'Session (5h)',
  weekly_all: 'Week · all models'
}

/** Maps SDK stream rate_limit_event types onto our window keys. */
const SDK_TYPE_TO_KEY: Record<string, { key: string; label: string }> = {
  five_hour: { key: 'session:', label: KIND_LABELS.session },
  seven_day: { key: 'weekly_all:', label: KIND_LABELS.weekly_all },
  seven_day_opus: { key: 'weekly_scoped:Opus', label: 'Week · Opus' },
  seven_day_sonnet: { key: 'weekly_scoped:Sonnet', label: 'Week · Sonnet' }
}

interface UsageLimitEntry {
  kind?: string
  percent?: number
  severity?: string
  resets_at?: string
  scope?: { model?: { display_name?: string | null } | null } | null
  is_active?: boolean
}

interface UsageResponse {
  limits?: UsageLimitEntry[] | null
  five_hour?: { utilization?: number; resets_at?: string } | null
  seven_day?: { utilization?: number; resets_at?: string } | null
}

/**
 * Claude usage meter. Primary source: the (unofficial) OAuth usage endpoint,
 * called gently — official-client User-Agent bucket, a minimum spacing
 * between calls, and a long cooldown after any 429, during which the last
 * good snapshot is served marked `stale`. Secondary source: rate_limit_event
 * messages harvested from agent streams update windows for free.
 */
export class UsageService {
  private snapshot: UsageSnapshot = {
    status: 'unavailable',
    plan: null,
    windows: [],
    fetchedAt: 0,
    reason: 'Loading…',
    stale: false
  }
  private timer: NodeJS.Timeout | null = null
  private lastFetchAt = 0
  private cooldownUntil = 0
  private fetching = false

  start(): void {
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), POLL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  get(): UsageSnapshot {
    return this.snapshot
  }

  /** Free usage data from an agent's stream — no API call involved. */
  ingestRateLimit(info: SDKRateLimitInfo): void {
    if (!info.rateLimitType || typeof info.utilization !== 'number') return
    const mapping = SDK_TYPE_TO_KEY[info.rateLimitType]
    if (!mapping) return
    const severity =
      info.status === 'rejected' ? 'exceeded' : info.status === 'allowed_warning' ? 'warning' : 'normal'
    const next: UsageWindow = {
      key: mapping.key,
      label: mapping.label,
      percent: clampPct(info.utilization),
      severity,
      resetsAt: normalizeEpoch(info.resetsAt),
      active: info.status !== 'allowed'
    }
    const windows = [...this.snapshot.windows]
    const index = windows.findIndex((w) => w.key === next.key || w.label === next.label)
    if (index === -1) windows.push(next)
    else windows[index] = { ...windows[index], ...next }
    this.snapshot = {
      ...this.snapshot,
      status: 'ok',
      windows,
      fetchedAt: Date.now(),
      reason: null
    }
    this.broadcast()
  }

  async refresh(): Promise<void> {
    const now = Date.now()
    if (this.fetching) return
    if (now < this.cooldownUntil || now - this.lastFetchAt < MIN_FETCH_INTERVAL_MS) return
    this.fetching = true
    this.lastFetchAt = now
    try {
      this.snapshot = await this.fetchSnapshot()
    } finally {
      this.fetching = false
    }
    this.broadcast()
  }

  private broadcast(): void {
    for (const wc of webContents.getAllWebContents()) {
      wc.send(IPC.EvUsageChanged, this.snapshot)
    }
  }

  /** Keep last good windows on failure instead of blanking the bar. */
  private degraded(reason: string, plan: string | null): UsageSnapshot {
    if (this.snapshot.windows.length > 0) {
      return { ...this.snapshot, plan: plan ?? this.snapshot.plan, reason, stale: true }
    }
    return {
      status: 'unavailable',
      plan,
      windows: [],
      fetchedAt: Date.now(),
      reason,
      stale: false
    }
  }

  private async fetchSnapshot(): Promise<UsageSnapshot> {
    let token: string | null = null
    let plan: string | null = null
    try {
      const credsPath = path.join(os.homedir(), '.claude', '.credentials.json')
      const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8')) as {
        claudeAiOauth?: { accessToken?: string; subscriptionType?: string }
      }
      token = creds.claudeAiOauth?.accessToken ?? null
      plan = creds.claudeAiOauth?.subscriptionType ?? null
    } catch {
      return this.degraded('No Claude Code login found on this machine.', null)
    }
    if (!token) return this.degraded('No access token in the Claude Code credentials.', plan)
    try {
      const res = await fetch(USAGE_URL, {
        headers: {
          Authorization: `Bearer ${token}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'User-Agent': USER_AGENT
        }
      })
      if (res.status === 429) {
        // retry-after is famously 0 here — apply our own long cooldown.
        this.cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS
        return this.degraded('Usage API rate-limited — showing last known values.', plan)
      }
      if (!res.ok) {
        return this.degraded(
          `Usage API returned ${res.status}${res.status === 401 ? ' — run Claude Code once to refresh the login' : ''}.`,
          plan
        )
      }
      const data = (await res.json()) as UsageResponse
      const windows = extractWindows(data)
      if (windows.length === 0) {
        return this.degraded('Usage response had no recognizable limits.', plan)
      }
      return { status: 'ok', plan, windows, fetchedAt: Date.now(), reason: null, stale: false }
    } catch (err) {
      return this.degraded(err instanceof Error ? err.message : String(err), plan)
    }
  }
}

function extractWindows(data: UsageResponse): UsageWindow[] {
  const windows: UsageWindow[] = []
  if (Array.isArray(data.limits)) {
    for (const limit of data.limits) {
      if (typeof limit?.percent !== 'number') continue
      const scopeName = limit.scope?.model?.display_name ?? null
      const kind = limit.kind ?? 'limit'
      windows.push({
        key: `${kind}:${scopeName ?? ''}`,
        label: scopeName ? `Week · ${scopeName}` : (KIND_LABELS[kind] ?? prettify(kind)),
        percent: clampPct(limit.percent),
        severity: limit.severity ?? 'normal',
        resetsAt: limit.resets_at ?? null,
        active: limit.is_active === true
      })
    }
  }
  if (windows.length === 0) {
    // Older response shape fallback.
    const legacy: [string, UsageResponse['five_hour']][] = [
      ['session', data.five_hour],
      ['weekly_all', data.seven_day]
    ]
    for (const [kind, entry] of legacy) {
      if (typeof entry?.utilization !== 'number') continue
      windows.push({
        key: `${kind}:`,
        label: KIND_LABELS[kind] ?? prettify(kind),
        percent: clampPct(entry.utilization),
        severity: 'normal',
        resetsAt: entry.resets_at ?? null,
        active: false
      })
    }
  }
  return windows
}

function normalizeEpoch(value: number | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  const ms = value < 1e12 ? value * 1000 : value
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function prettify(kind: string): string {
  return kind.replace(/_/g, ' ')
}
