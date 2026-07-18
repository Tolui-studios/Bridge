import { useEffect, useRef, useState } from 'react'

interface Props {
  value: string
  /** Shown (dimmed) when value is empty; clicking it starts an edit. */
  placeholder: string
  onSave: (text: string) => Promise<void>
  /** Classes for the read view (a button) and the edit input. */
  className: string
  inputClassName: string
  title?: string
}

/** Click-to-edit text: Enter saves, Escape or blur cancels. */
export default function EditableText({
  value,
  placeholder,
  onSave,
  className,
  inputClassName,
  title
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  if (!editing) {
    return (
      <button
        onClick={() => {
          setDraft(value)
          setEditing(true)
        }}
        title={title ?? 'Click to edit'}
        className={`${className} cursor-text text-left ${value ? '' : 'italic text-neutral-600'}`}
      >
        {value || placeholder}
      </button>
    )
  }

  return (
    <input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setEditing(false)
        if (e.key === 'Enter') {
          const text = draft.trim()
          setEditing(false)
          if (text && text !== value) void onSave(text)
        }
      }}
      className={inputClassName}
    />
  )
}
