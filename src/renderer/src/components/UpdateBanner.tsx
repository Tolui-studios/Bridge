import { useEffect, useState } from 'react'
import type { UpdateState } from '@shared/types'

/**
 * A quiet strip shown only once an update has finished downloading. Updates
 * apply on quit, so there is nothing to click — this exists so a restart that
 * changes the version is never a surprise.
 */
export default function UpdateBanner() {
  const [state, setState] = useState<UpdateState | null>(null)

  useEffect(() => {
    void window.bridge
      .getUpdateState()
      .then(setState)
      .catch(() => {})
    return window.bridge.onUpdateChanged(setState)
  }, [])

  if (state?.status !== 'ready') return null

  return (
    <div className="flex items-center justify-center gap-2 border-b border-emerald-900/60 bg-emerald-950/40 px-4 py-1.5">
      <span className="text-[11px] text-emerald-300">
        Bridge {state.version} downloaded — installs automatically when you close the app.
      </span>
    </div>
  )
}
