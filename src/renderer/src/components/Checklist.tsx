import type { ChecklistItem } from '@shared/types'

export default function Checklist({ items }: { items: ChecklistItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-neutral-500">No checklist items in GOALS.md yet.</p>
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item, index) => (
        <li
          key={index}
          className={`flex items-start gap-2.5 rounded-md px-3 py-2 text-sm ${
            item.inProgress ? 'bg-amber-500/10 ring-1 ring-inset ring-amber-500/30' : ''
          }`}
        >
          <span
            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
              item.done
                ? 'border-emerald-500 bg-emerald-500 text-neutral-950'
                : item.inProgress
                  ? 'border-amber-400 text-transparent'
                  : 'border-neutral-600 text-transparent'
            }`}
          >
            ✓
          </span>
          <span
            className={
              item.done
                ? 'text-neutral-500 line-through'
                : item.inProgress
                  ? 'text-amber-200'
                  : 'text-neutral-300'
            }
          >
            {item.text}
          </span>
          {item.inProgress && (
            <span className="ml-auto shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
              in progress
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}
