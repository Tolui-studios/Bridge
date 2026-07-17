import { useCallback, useEffect, useState } from 'react'
import type { AddGameInput, Game, GameMutationResult } from '@shared/types'

export function useGames(): {
  games: Game[]
  loaded: boolean
  addGame: (input: AddGameInput) => Promise<GameMutationResult>
  updateGame: (game: Game) => Promise<GameMutationResult>
  removeGame: (id: string) => Promise<void>
} {
  const [games, setGames] = useState<Game[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    void window.bridge.listGames().then((list) => {
      if (alive) {
        setGames(list)
        setLoaded(true)
      }
    })
    const unsubscribe = window.bridge.onRegistryChanged((list) => setGames(list))
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  const addGame = useCallback((input: AddGameInput) => window.bridge.addGame(input), [])
  const updateGame = useCallback((game: Game) => window.bridge.updateGame(game), [])
  const removeGame = useCallback((id: string) => window.bridge.removeGame(id), [])

  return { games, loaded, addGame, updateGame, removeGame }
}
