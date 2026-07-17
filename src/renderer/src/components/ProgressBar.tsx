import type { Progress } from '@shared/types'

export default function ProgressBar({ progress }: { progress: Progress }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
          Progress
        </span>
        <span className="text-xs tabular-nums text-neutral-400">
          {progress.done} / {progress.total} · {progress.pct}%
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-800">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all duration-500"
          style={{ width: `${progress.pct}%` }}
        />
      </div>
    </div>
  )
}
