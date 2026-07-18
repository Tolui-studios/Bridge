import { useCallback, useEffect, useState } from 'react'
import type { AgentLaunchConfig, AgentSessionSummary, AgentStreamItem } from '@shared/types'
import { cleanIpcError } from '../lib/ipcError'

export function useAgents(gameId: string): {
  sessions: AgentSessionSummary[]
  activeId: string | null
  setActiveId: (id: string | null) => void
  transcript: AgentStreamItem[]
  start: (config: AgentLaunchConfig) => Promise<boolean>
  cancel: (sessionId: string) => void
  error: string | null
  clearError: () => void
} {
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([])
  const [transcripts, setTranscripts] = useState<Record<string, AgentStreamItem[]>>({})
  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSessions([])
    setTranscripts({})
    setActiveId(null)
    setError(null)
    let alive = true
    void window.bridge.listAgentSessions(gameId).then((list) => {
      if (!alive) return
      setSessions(list)
      setActiveId((prev) => prev ?? list[0]?.id ?? null)
    })
    const unsubscribe = window.bridge.onAgentEvent((event) => {
      if (event.type === 'status') {
        if (event.session.gameId !== gameId) return
        setSessions((prev) => {
          const index = prev.findIndex((s) => s.id === event.session.id)
          if (index === -1) return [event.session, ...prev]
          const next = [...prev]
          next[index] = event.session
          return next
        })
        if (event.session.status === 'running') setActiveId(event.session.id)
      } else {
        if (event.item.gameId !== gameId) return
        setTranscripts((prev) => ({
          ...prev,
          [event.item.sessionId]: [...(prev[event.item.sessionId] ?? []), event.item]
        }))
      }
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [gameId])

  useEffect(() => {
    if (!activeId || transcripts[activeId]) return
    let alive = true
    void window.bridge
      .getAgentTranscript(activeId)
      .then((items) => {
        if (!alive) return
        setTranscripts((prev) => {
          const local = prev[activeId] ?? []
          const known = new Set(items.map((i) => i.id))
          return { ...prev, [activeId]: [...items, ...local.filter((i) => !known.has(i.id))] }
        })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [activeId, transcripts])

  const start = useCallback(
    async (config: AgentLaunchConfig): Promise<boolean> => {
      setError(null)
      try {
        await window.bridge.startAgent(gameId, config)
        return true
      } catch (err) {
        setError(cleanIpcError(err))
        return false
      }
    },
    [gameId]
  )

  const cancel = useCallback((sessionId: string): void => {
    window.bridge.cancelAgent(sessionId).catch((err) => setError(cleanIpcError(err)))
  }, [])

  return {
    sessions,
    activeId,
    setActiveId,
    transcript: activeId ? (transcripts[activeId] ?? []) : [],
    start,
    cancel,
    error,
    clearError: () => setError(null)
  }
}
