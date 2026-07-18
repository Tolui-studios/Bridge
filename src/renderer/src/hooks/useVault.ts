import { useCallback, useEffect, useState } from 'react'
import type { AppSettings, VaultNoteRef } from '@shared/types'
import { cleanIpcError } from '../lib/ipcError'

export function useSettings(): {
  settings: AppSettings | null
  connectVault: () => Promise<void>
  disconnectVault: () => Promise<void>
  openVault: () => void
  error: string | null
} {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void window.bridge.getSettings().then((s) => {
      if (alive) setSettings(s)
    })
    const unsubscribe = window.bridge.onSettingsChanged((s) => setSettings(s))
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  const connectVault = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      const picked = await window.bridge.pickFolder()
      if (!picked) return
      setSettings(await window.bridge.setVaultPath(picked))
    } catch (err) {
      setError(cleanIpcError(err))
    }
  }, [])

  const disconnectVault = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      setSettings(await window.bridge.setVaultPath(null))
    } catch (err) {
      setError(cleanIpcError(err))
    }
  }, [])

  const openVault = useCallback((): void => {
    window.bridge.openVault().catch((err) => setError(cleanIpcError(err)))
  }, [])

  return { settings, connectVault, disconnectVault, openVault, error }
}

export function useVaultNotes(gameId: string): VaultNoteRef[] {
  const [notes, setNotes] = useState<VaultNoteRef[]>([])

  useEffect(() => {
    let alive = true
    const load = (): void => {
      window.bridge
        .listVaultNotes(gameId)
        .then((list) => {
          if (alive) setNotes(list)
        })
        .catch(() => {
          if (alive) setNotes([])
        })
    }
    load()
    const unsubscribe = window.bridge.onSettingsChanged(() => load())
    return () => {
      alive = false
      unsubscribe()
    }
  }, [gameId])

  return notes
}
