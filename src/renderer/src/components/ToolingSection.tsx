import { useEffect, useState } from 'react'
import type { Game, ToolingReport } from '@shared/types'

function version(spec: string): string {
  const at = spec.lastIndexOf('@')
  return at === -1 ? spec : spec.slice(at + 1)
}

/**
 * Broad-glance view of a game's stack: Rokit toolchain pins, Wally packages
 * (dev deps dimmed, commented-out genre packages shown as "off"), and which
 * config files exist — so the operator can read the AI's codebase at a
 * glance without opening files.
 */
export default function ToolingSection({ game }: { game: Game }) {
  const [report, setReport] = useState<ToolingReport | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setReport(null)
    setOpen(false)
    let alive = true
    window.bridge
      .getTooling(game.id)
      .then((r) => {
        if (alive) setReport(r)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [game.id])

  if (!report || (report.tools.length === 0 && report.packages.length === 0)) return null

  const active = report.packages.filter((p) => !p.dev && !p.optional)
  const dev = report.packages.filter((p) => p.dev)
  const optional = report.packages.filter((p) => p.optional)

  return (
    <div className="mb-6 rounded-lg border border-neutral-800 bg-neutral-900/30 px-4 py-3">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 text-left">
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
          Tooling
        </span>
        <span className="text-[11px] text-neutral-600">
          {report.tools.length} tools · {active.length} packages
          {optional.length > 0 ? ` · ${optional.length} optional` : ''}
        </span>
        <span className="ml-auto text-[11px] text-neutral-600">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3 border-t border-neutral-800/60 pt-3">
          {report.tools.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[10px] font-medium uppercase tracking-wide text-neutral-600">
                Toolchain
              </span>
              {report.tools.map((tool) => (
                <span
                  key={tool.name}
                  title={tool.spec}
                  className="rounded-full border border-sky-900/60 bg-sky-950/30 px-2.5 py-0.5 text-[11px] text-sky-300"
                >
                  {tool.name} {version(tool.spec)}
                </span>
              ))}
            </div>
          )}

          {active.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[10px] font-medium uppercase tracking-wide text-neutral-600">
                Packages
              </span>
              {active.map((pkg) => (
                <span
                  key={pkg.name}
                  title={`${pkg.spec}${pkg.comment ? ` — ${pkg.comment}` : ''}`}
                  className="rounded-full border border-neutral-700 bg-neutral-900 px-2.5 py-0.5 text-[11px] text-neutral-300"
                >
                  {pkg.name} {version(pkg.spec)}
                </span>
              ))}
            </div>
          )}

          {optional.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[10px] font-medium uppercase tracking-wide text-neutral-600">
                Optional
              </span>
              {optional.map((pkg) => (
                <span
                  key={pkg.name}
                  title={`${pkg.spec}${pkg.comment ? ` — ${pkg.comment}` : ''} (commented out in wally.toml)`}
                  className="rounded-full border border-dashed border-neutral-700 px-2.5 py-0.5 text-[11px] text-neutral-600"
                >
                  {pkg.name} · off
                </span>
              ))}
            </div>
          )}

          {dev.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[10px] font-medium uppercase tracking-wide text-neutral-600">
                Dev
              </span>
              {dev.map((pkg) => (
                <span
                  key={pkg.name}
                  title={pkg.spec}
                  className="rounded-full border border-neutral-800 px-2.5 py-0.5 text-[11px] text-neutral-500"
                >
                  {pkg.name} {version(pkg.spec)}
                </span>
              ))}
            </div>
          )}

          {report.configs.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[10px] font-medium uppercase tracking-wide text-neutral-600">
                Configs
              </span>
              {report.configs.map((config) => (
                <span
                  key={config}
                  className="rounded border border-neutral-800 px-2 py-0.5 text-[10px] text-neutral-500"
                >
                  {config}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
