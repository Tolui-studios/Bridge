import { useEffect, useState } from 'react'
import type { UpdateState } from '@shared/types'

/** Auto-update status, kept live by the main process. Null until first load. */
export function useUpdate(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null)

  useEffect(() => {
    void window.bridge
      .getUpdateState()
      .then(setState)
      .catch(() => {})
    return window.bridge.onUpdateChanged(setState)
  }, [])

  return state
}
