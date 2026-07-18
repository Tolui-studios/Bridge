import { webContents } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { IPC } from '@shared/ipc-channels'
import type { UsageSnapshot, UsageWindow } from '@shared/types'

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const POLL_MS = 10_000

const KIND_LABELS: Record<string, string> = {
  session: 'Session (5h)',
  weekly_all: 'Week · all models'
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
 * Polls the same (unofficial) OAuth usage endpoint the Claude Code /usage
 * screen uses, with the token from the machine's Claude Code login. Degrades
 * to an 'unavailable' snapshot with a reason instead of ever throwing.
 */
export class UsageService {
  private snapshot: UsageSnapshot = {
    status: 'unavailable',
    plan: null,
    windows: [],
    fetchedAt: 0,
    reason: 'Loading…'
  }
  private timer: NodeJS.Timeout | null = null

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

  async refresh(): Promise<void> {
    this.snapshot = await this.fetchSnapshot()
    for (const wc of webContents.getAllWebContents()) {
      wc.send(IPC.EvUsageChanged, this.snapshot)
    }
  }

  private async fetchSnapshot(): Promise<UsageSnapshot> {
    const unavailable = (reason: string, plan: string | null = null): UsageSnapshot => ({
      status: 'unavailable',
      plan,
      windows: [],
      fetchedAt: Date.now(),
      reason
    })
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
      return unavailable('No Claude Code login found on this machine.')
    }
    if (!token) return unavailable('No access token in the Claude Code credentials.')
    try {
      const res = await fetch(USAGE_URL, {
        headers: {
          Authorization: `Bearer ${token}`,
          'anthropic-beta': 'oauth-2025-04-20'
        }
      })
      if (!res.ok) {
        return unavailable(
          `Usage API returned ${res.status}${res.status === 401 ? ' — run Claude Code once to refresh the login' : ''}.`,
          plan
        )
      }
      const data = (await res.json()) as UsageResponse
      const windows = extractWindows(data)
      if (windows.length === 0) return unavailable('Usage response had no recognizable limits.', plan)
      return { status: 'ok', plan, windows, fetchedAt: Date.now(), reason: null }
    } catch (err) {
      return unavailable(err instanceof Error ? err.message : String(err), plan)
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
        key: kind,
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

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function prettify(kind: string): string {
  return kind.replace(/_/g, ' ')
}
