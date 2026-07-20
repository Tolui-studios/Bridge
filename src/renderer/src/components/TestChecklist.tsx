import { useEffect, useState } from 'react'
import type { AgentSessionSummary } from '@shared/types'

/**
 * How a finished run hands verification back to a human. Agents can't play the
 * game, so they report `BRIDGE:TEST` steps instead of claiming they tested it,
 * and those land here as a checklist the operator ticks off in Studio.
 *
 * Ticks are local to this machine (localStorage, keyed by session) — they are
 * a scratchpad for the person testing, not shared state.
 */
export default function TestChecklist({
  session,
  onClose
}: {
  session: AgentSessionSummary
  onClose: () => void
}) {
  const storageKey = `bridge.testChecks.${session.id}`
  const [checked, setChecked] = useState<Record<number, boolean>>({})

  useEffect(() => {
    try {
      setChecked(JSON.parse(localStorage.getItem(storageKey) ?? '{}'))
    } catch {
      setChecked({})
    }
  }, [storageKey])

  const toggle = (index: number): void => {
    setChecked((prev) => {
      const next = { ...prev, [index]: !prev[index] }
      try {
        localStorage.setItem(storageKey, JSON.stringify(next))
      } catch {
        // A full/blocked localStorage shouldn't break the checklist.
      }
      return next
    })
  }

  const doneCount = session.testSteps.filter((_, i) => checked[i]).length
  const allDone = doneCount === session.testSteps.length

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-neutral-100">Test this in Studio</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
          The agent wrote the code but cannot run the game. Work through these in Roblox Studio to
          confirm the change actually behaves.
        </p>
        <p className="mt-2 truncate font-mono text-[10px] text-neutral-600" title={session.task}>
          {session.task}
        </p>

        <ul className="mt-4 space-y-2">
          {session.testSteps.map((step, index) => (
            <li key={index}>
              <label className="flex cursor-pointer items-start gap-2.5 rounded px-1 py-1 hover:bg-neutral-800/50">
                <input
                  type="checkbox"
                  checked={checked[index] ?? false}
                  onChange={() => toggle(index)}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-emerald-500"
                />
                <span
                  className={`text-xs leading-relaxed ${
                    checked[index] ? 'text-neutral-600 line-through' : 'text-neutral-300'
                  }`}
                >
                  {step}
                </span>
              </label>
            </li>
          ))}
        </ul>

        <div className="mt-5 flex items-center justify-between">
          <span className={`text-[11px] ${allDone ? 'text-emerald-400' : 'text-neutral-500'}`}>
            {doneCount} / {session.testSteps.length} checked
          </span>
          <button
            onClick={onClose}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:bg-neutral-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
