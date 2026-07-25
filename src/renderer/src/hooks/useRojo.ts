import { useEffect, useState } from 'react'
import type { RojoServeStatus } from '@shared/types'

/** Live rojo serve state for one game, kept fresh by the main process. Null until first load. */
export function useRojo(gameId: string): RojoServeStatus | null {
  const [status, setStatus] = useState<RojoServeStatus | null>(null)

  useEffect(() => {
    setStatus(null)
    void window.bridge
      .rojoStatus(gameId)
      .then(setStatus)
      .catch(() => {})
    return window.bridge.onRojoChanged((s) => {
      if (s.gameId === gameId) setStatus(s)
    })
  }, [gameId])

  return status
}
