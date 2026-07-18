import { useEffect, useRef, useState } from 'react'
import type { ChecklistItem } from '@shared/types'

interface Props {
  items: ChecklistItem[]
  onToggle: (index: number, item: ChecklistItem) => void
  onEditText: (index: number, item: ChecklistItem, text: string) => void
  onRemove: (index: number, item: ChecklistItem) => void
  onSetInProgress: (index: number | null, item?: ChecklistItem) => void
  /** Rejects on failure so the add row can keep the typed text. */
  onAdd: (text: string) => Promise<void>
}

export default function Checklist({
  items,
  onToggle,
  onEditText,
  onRemove,
  onSetInProgress,
  onAdd
}: Props) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const editRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingIndex !== null) editRef.current?.select()
  }, [editingIndex])

  return (
    <div>
      {items.length === 0 && (
        <p className="mb-2 text-sm text-neutral-500">No checklist items yet — add the first one below.</p>
      )}
      <ul className="space-y-1.5">
        {items.map((item, index) => (
          <li
            key={`${index}-${item.text}`}
            className={`group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm ${
              item.inProgress ? 'bg-amber-500/10 ring-1 ring-inset ring-amber-500/30' : ''
            }`}
          >
            <button
              onClick={() => onToggle(index, item)}
              title={item.done ? 'Mark as not done' : 'Mark as done'}
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] transition-colors ${
                item.done
                  ? 'border-emerald-500 bg-emerald-500 text-neutral-950'
                  : item.inProgress
                    ? 'border-amber-400 text-transparent hover:bg-amber-400/20'
                    : 'border-neutral-600 text-transparent hover:border-emerald-500 hover:bg-emerald-500/20'
              }`}
            >
              ✓
            </button>

            {editingIndex === index ? (
              <input
                ref={editRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => setEditingIndex(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setEditingIndex(null)
                  if (e.key === 'Enter') {
                    const text = draft.trim()
                    setEditingIndex(null)
                    if (text && text !== item.text) onEditText(index, item, text)
                  }
                }}
                className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-0.5 text-sm text-neutral-200 outline-none focus:border-emerald-600"
              />
            ) : (
              <span
                className={`min-w-0 flex-1 truncate ${
                  item.done
                    ? 'text-neutral-500 line-through'
                    : item.inProgress
                      ? 'text-amber-200'
                      : 'text-neutral-300'
                }`}
                title={item.text}
              >
                {item.text}
              </span>
            )}

            {item.inProgress && (
              <span className="shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
                in progress
              </span>
            )}

            <span className="hidden shrink-0 items-center gap-1 group-hover:flex">
              {!item.done && (
                <button
                  onClick={() =>
                    item.inProgress ? onSetInProgress(null) : onSetInProgress(index, item)
                  }
                  title={item.inProgress ? 'Clear in-progress' : 'Mark in progress'}
                  className="rounded px-1.5 py-0.5 text-[11px] text-amber-400/70 hover:bg-amber-500/10 hover:text-amber-300"
                >
                  ◉
                </button>
              )}
              <button
                onClick={() => {
                  setDraft(item.text)
                  setEditingIndex(index)
                }}
                title="Edit text"
                className="rounded px-1.5 py-0.5 text-[11px] text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
              >
                ✎
              </button>
              <button
                onClick={() => onRemove(index, item)}
                title="Remove item"
                className="rounded px-1.5 py-0.5 text-[11px] text-neutral-500 hover:bg-red-950/50 hover:text-red-400"
              >
                ✕
              </button>
            </span>
          </li>
        ))}
      </ul>
      <AddItemRow onAdd={onAdd} />
    </div>
  )
}

function AddItemRow({ onAdd }: { onAdd: (text: string) => Promise<void> }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      await onAdd(trimmed)
      setText('')
    } catch {
      // Error surfaced by the panel; keep the typed text for retry.
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 flex gap-2">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
        }}
        placeholder="Add a checklist item…"
        className="min-w-0 flex-1 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-emerald-600"
      />
      <button
        onClick={() => void submit()}
        disabled={!text.trim() || busy}
        className="shrink-0 rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:bg-neutral-800 disabled:opacity-40"
      >
        Add
      </button>
    </div>
  )
}
