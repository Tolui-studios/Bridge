import { useEffect, useState } from 'react'
import type { UsageSnapshot, UsageWindow } from '@shared/types'

export default function UsageBar() {
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null)

  useEffect(() => {
    let alive = true
    void window.bridge.getUsage().then((s) => {
      if (alive) setSnapshot(s)
    })
    const unsubscribe = window.bridge.onUsageChanged((s) => setSnapshot(s))
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  if (!snapshot) return null

  return (
    <div className="border-t border-neutral-800 px-4 py-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
          Claude usage
          {snapshot.stale && (
            <span className="ml-1.5 normal-case tracking-normal text-amber-500/80" title={snapshot.reason ?? 'Rate-limited — showing last known values'}>
              · stale
            </span>
          )}
        </span>
        {snapshot.plan && (
          <span className="rounded-full border border-neutral-700 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-neutral-500">
            {snapshot.plan}
          </span>
        )}
      </div>
      {snapshot.status === 'unavailable' ? (
        <p className="text-[10px] leading-snug text-neutral-600" title={snapshot.reason ?? ''}>
          {snapshot.reason ?? 'Usage unavailable.'}
        </p>
      ) : (
        <div className="space-y-2">
          {snapshot.windows.map((window) => (
            <WindowRow key={window.key} window={window} />
          ))}
        </div>
      )}
    </div>
  )
}

function WindowRow({ window: w }: { window: UsageWindow }) {
  const barColor =
    w.severity !== 'normal' || w.percent >= 85
      ? 'bg-red-500'
      : w.percent >= 60
        ? 'bg-amber-500'
        : 'bg-emerald-500'
  return (
    <div title={w.resetsAt ? `Resets ${formatReset(w.resetsAt)}` : undefined}>
      <div className="mb-0.5 flex items-baseline justify-between">
        <span className="truncate text-[10px] text-neutral-500">{w.label}</span>
        <span className="ml-2 shrink-0 text-[10px] tabular-nums text-neutral-400">{w.percent}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
        <div
          className={`h-full rounded-full transition-all duration-700 ${barColor}`}
          style={{ width: `${Math.max(w.percent, 2)}%` }}
        />
      </div>
    </div>
  )
}

function formatReset(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString([], {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit'
  })
}
