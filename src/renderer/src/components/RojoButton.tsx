import { useEffect, useState } from 'react'
import type { Game } from '@shared/types'
import { useRojo } from '../hooks/useRojo'
import { cleanIpcError } from '../lib/ipcError'

interface Props {
  game: Game
  onError: (message: string | null) => void
  onInfo: (message: string | null) => void
}

/**
 * The one-click dev loop: VS Code + rojo serve + Roblox Studio. While serving,
 * shows the target and port (34872 is what the Studio plugin auto-detects)
 * with a Stop; serving a worktree adds a one-click swap back to main.
 */
export default function RojoButton({ game, onError, onInfo }: Props) {
  const status = useRojo(game.id)
  const [busy, setBusy] = useState(false)

  // A serve that died on its own (not via Stop) leaves a note — surface it once.
  const crashNote = status && !status.running ? status.note : null
  useEffect(() => {
    if (crashNote) onError(crashNote)
  }, [crashNote, onError])

  const openBuild = async (): Promise<void> => {
    onError(null)
    onInfo(null)
    setBusy(true)
    try {
      const result = await window.bridge.rojoOpenBuild(game.id)
      const parts = [
        `Serving ${result.status.targetLabel ?? 'main'} on :${result.status.port} — connect the Rojo plugin in Studio.`
      ]
      parts.push(...result.notes)
      onInfo(parts.join(' '))
    } catch (err) {
      onError(cleanIpcError(err))
    } finally {
      setBusy(false)
    }
  }

  const stop = async (): Promise<void> => {
    onError(null)
    try {
      const message = await window.bridge.rojoStop(game.id)
      if (message) onInfo(message)
    } catch (err) {
      onError(cleanIpcError(err))
    }
  }

  if (status?.running) {
    const servingWorktree = status.targetLabel !== null && status.targetLabel !== 'main'
    return (
      <span className="flex items-center gap-1.5">
        <span
          title={`rojo serve ${status.reused ? '(started outside Bridge) ' : ''}on port ${status.port}, serving ${status.targetPath ?? 'the repo'} — the Studio plugin auto-detects :34872`}
          className="rounded-md border border-emerald-800/60 bg-emerald-950/30 px-2.5 py-1.5 text-xs text-emerald-300"
        >
          ● {status.targetLabel ?? 'main'} :{status.port}
        </span>
        {servingWorktree && (
          <button
            onClick={() => void openBuild()}
            disabled={busy}
            title="Swap the serve back to the main checkout"
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:bg-neutral-800 disabled:opacity-40"
          >
            {busy ? 'Swapping…' : 'Serve main'}
          </button>
        )}
        <button
          onClick={() => void stop()}
          title={
            status.reused
              ? 'Detach from this externally started rojo serve (leaves it running)'
              : 'Stop this rojo serve'
          }
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:bg-neutral-800"
        >
          Stop
        </button>
      </span>
    )
  }

  return (
    <button
      onClick={() => void openBuild()}
      disabled={busy}
      title="Open VS Code, start rojo serve, and launch Roblox Studio"
      className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:bg-neutral-800 disabled:opacity-40"
    >
      {busy ? 'Opening…' : 'Open Build'}
    </button>
  )
}
