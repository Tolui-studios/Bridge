import { useState } from 'react'
import { useUpdate } from '../hooks/useUpdate'
import { cleanIpcError } from '../lib/ipcError'

/**
 * Shown only once an update has finished downloading. It already installs on
 * quit, so the button is a convenience: it makes "restart into the new
 * version" immediate instead of depending on the installer finishing in the
 * few seconds after the process exits.
 */
export default function UpdateBanner() {
  const state = useUpdate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (state?.status !== 'ready') return null

  const restart = (): void => {
    setBusy(true)
    setError(null)
    window.bridge.installUpdate().catch((err) => {
      setError(cleanIpcError(err))
      setBusy(false)
    })
  }

  return (
    <div className="border-b border-emerald-900/60 bg-emerald-950/40 px-4 py-1.5">
      <div className="flex items-center justify-center gap-3">
        <span className="text-[11px] text-emerald-300">
          Bridge {state.version} is downloaded and installs when you close the app.
        </span>
        <button
          onClick={restart}
          disabled={busy}
          title="Install now and reopen Bridge on the new version"
          className="shrink-0 rounded border border-emerald-700 px-2 py-0.5 text-[10px] text-emerald-300 transition-colors hover:bg-emerald-900/40 disabled:opacity-40"
        >
          {busy ? 'Restarting…' : 'Restart now'}
        </button>
      </div>
      {error && <p className="mt-1 text-center text-[10px] text-red-400">{error}</p>}
    </div>
  )
}
