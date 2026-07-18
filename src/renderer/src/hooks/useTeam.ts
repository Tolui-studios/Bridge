import { useCallback, useEffect, useState } from 'react'
import type { TeamConnectInput, TeamState } from '@shared/types'
import { cleanIpcError } from '../lib/ipcError'

const OFFLINE: TeamState = { status: 'off', reason: null, me: null, users: [], sessions: [] }

export function useTeam(): {
  team: TeamState
  connect: (input: TeamConnectInput) => Promise<TeamState>
  disconnect: () => Promise<void>
  error: string | null
  clearError: () => void
} {
  const [team, setTeam] = useState<TeamState>(OFFLINE)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void window.bridge.getTeamState().then((state) => {
      if (alive) setTeam(state)
    })
    const unsubscribe = window.bridge.onTeamChanged((state) => setTeam(state))
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  const connect = useCallback(async (input: TeamConnectInput): Promise<TeamState> => {
    setError(null)
    try {
      const state = await window.bridge.teamConnect(input)
      setTeam(state)
      return state
    } catch (err) {
      setError(cleanIpcError(err))
      throw err
    }
  }, [])

  const disconnect = useCallback(async (): Promise<void> => {
    try {
      setTeam(await window.bridge.teamDisconnect())
    } catch (err) {
      setError(cleanIpcError(err))
    }
  }, [])

  return { team, connect, disconnect, error, clearError: () => setError(null) }
}
