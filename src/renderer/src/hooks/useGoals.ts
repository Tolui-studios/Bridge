import { useCallback, useEffect, useState } from 'react'
import type { GoalsMutation, GoalsState } from '@shared/types'

export function useGoals(gameId: string | null): {
  state: GoalsState | null
  refresh: () => void
  createTemplate: () => void
  mutate: (mutation: GoalsMutation) => Promise<void>
} {
  const [state, setState] = useState<GoalsState | null>(null)

  useEffect(() => {
    setState(null)
    if (!gameId) return
    let alive = true
    void window.bridge
      .getGoals(gameId)
      .then((s) => {
        if (alive) setState(s)
      })
      .catch(() => {})
    const unsubscribe = window.bridge.onGoalsChanged((s) => {
      if (s.gameId === gameId) setState(s)
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [gameId])

  const refresh = useCallback(() => {
    if (!gameId) return
    void window.bridge
      .getGoals(gameId)
      .then(setState)
      .catch(() => {})
  }, [gameId])

  const createTemplate = useCallback(() => {
    if (!gameId) return
    void window.bridge
      .createGoalsTemplate(gameId)
      .then(setState)
      .catch(() => {})
  }, [gameId])

  const mutate = useCallback(
    async (mutation: GoalsMutation): Promise<void> => {
      if (!gameId) return
      const next = await window.bridge.mutateGoals(gameId, mutation)
      setState(next)
    },
    [gameId]
  )

  return { state, refresh, createTemplate, mutate }
}
