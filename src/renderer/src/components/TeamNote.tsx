import { useEffect, useRef, useState } from 'react'
import type { TeamNoteState } from '@shared/types'
import { cleanIpcError } from '../lib/ipcError'

/**
 * The shared per-project note: any teammate can edit it, live. Saves are
 * debounced; a remote change while you're typing surfaces as a reload chip
 * instead of clobbering your draft.
 */
export default function TeamNote({ gameId }: { gameId: string }) {
  const [note, setNote] = useState<TeamNoteState | null>(null)
  const [draft, setDraft] = useState('')
  const [available, setAvailable] = useState(false)
  const [remoteChanged, setRemoteChanged] = useState<TeamNoteState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const focusedRef = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const noteRef = useRef<TeamNoteState | null>(null)
  noteRef.current = note

  useEffect(() => {
    setNote(null)
    setDraft('')
    setAvailable(false)
    setRemoteChanged(null)
    setError(null)
    let alive = true
    void window.bridge
      .getTeamNote(gameId)
      .then((state) => {
        if (!alive) return
        if (state) {
          setNote(state)
          setDraft(state.content)
          setAvailable(true)
        }
      })
      .catch(() => {})
    const unsubscribe = window.bridge.onTeamNote(({ gameId: id, note: incoming }) => {
      if (id !== gameId) return
      if (focusedRef.current && incoming.updatedBy) {
        // Someone else changed it while we're editing — offer, don't clobber.
        if (incoming.version !== noteRef.current?.version) setRemoteChanged(incoming)
      } else {
        setNote(incoming)
        setDraft(incoming.content)
      }
    })
    return () => {
      alive = false
      unsubscribe()
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [gameId])

  const scheduleSave = (content: string): void => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const base = noteRef.current?.version ?? 0
      window.bridge
        .saveTeamNote(gameId, content, base)
        .then((saved) => {
          setNote(saved)
          setError(null)
          setSavedAt(Date.now())
        })
        .catch((err) => setError(cleanIpcError(err)))
    }, 800)
  }

  if (!available) return null

  return (
    <section className="mt-8 border-t border-neutral-900 pt-6">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
          Team note
        </h3>
        <span className="text-[10px] text-neutral-600">
          {note?.updatedBy
            ? `last edit ${note.updatedBy}${savedAt ? ' · saved' : ''}`
            : 'shared with your team'}
        </span>
      </div>
      {remoteChanged && (
        <div className="mb-2 flex items-center justify-between rounded-md border border-sky-900/60 bg-sky-950/30 px-3 py-1.5">
          <span className="text-[11px] text-sky-300">
            {remoteChanged.updatedBy ?? 'A teammate'} updated this note while you were typing.
          </span>
          <button
            onClick={() => {
              setNote(remoteChanged)
              setDraft(remoteChanged.content)
              setRemoteChanged(null)
            }}
            className="shrink-0 rounded border border-sky-800 px-2 py-0.5 text-[10px] text-sky-300 hover:bg-sky-950"
          >
            Load theirs
          </button>
        </div>
      )}
      <textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          scheduleSave(e.target.value)
        }}
        onFocus={() => {
          focusedRef.current = true
        }}
        onBlur={() => {
          focusedRef.current = false
        }}
        rows={4}
        placeholder="Shared scratchpad for this project — visible and editable by every teammate…"
        className="w-full resize-y rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-sky-700"
      />
      {error && <p className="mt-1 text-[11px] text-red-400">{error}</p>}
    </section>
  )
}
