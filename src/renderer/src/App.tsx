import { useEffect, useMemo, useState } from 'react'
import type { Game } from '@shared/types'
import { useGames } from './hooks/useGames'
import Sidebar from './components/Sidebar'
import GamePanel from './components/GamePanel'
import AddGameModal from './components/AddGameModal'

type ModalState = { mode: 'add' } | { mode: 'edit'; game: Game } | null

const SELECTED_KEY = 'bridge.selectedGameId'

export default function App() {
  const { games, loaded, addGame, updateGame, removeGame } = useGames()
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    localStorage.getItem(SELECTED_KEY)
  )
  const [modal, setModal] = useState<ModalState>(null)

  const selected = useMemo(
    () => games.find((g) => g.id === selectedId) ?? null,
    [games, selectedId]
  )

  useEffect(() => {
    if (selectedId) localStorage.setItem(SELECTED_KEY, selectedId)
  }, [selectedId])

  useEffect(() => {
    if (loaded && !selected && games.length > 0) {
      setSelectedId(games[0].id)
    }
  }, [loaded, selected, games])

  useEffect(() => {
    void window.bridge.setTeamFocus(selected?.id ?? null).catch(() => {})
  }, [selected?.id])

  return (
    <div className="flex h-full bg-neutral-950 text-neutral-200">
      <Sidebar
        games={games}
        selectedId={selected?.id ?? null}
        onSelect={setSelectedId}
        onAdd={() => setModal({ mode: 'add' })}
      />
      <main className="min-w-0 flex-1 overflow-y-auto">
        {selected ? (
          <GamePanel
            key={selected.id}
            game={selected}
            onEdit={() => setModal({ mode: 'edit', game: selected })}
            onRemove={() => {
              void removeGame(selected.id)
              setSelectedId(null)
            }}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-neutral-500">
              {loaded ? 'No game selected.' : 'Loading…'}
            </p>
            {loaded && games.length === 0 && (
              <button
                onClick={() => setModal({ mode: 'add' })}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
              >
                + Add your first game
              </button>
            )}
          </div>
        )}
      </main>
      {modal && (
        <AddGameModal
          initial={modal.mode === 'edit' ? modal.game : null}
          onClose={() => setModal(null)}
          onSubmit={async (value) => {
            const result = 'id' in value ? await updateGame(value) : await addGame(value)
            setSelectedId(result.game.id)
            return result
          }}
          onCreate={async (name) => {
            const result = await window.bridge.createGame(name)
            setSelectedId(result.game.id)
            return result
          }}
        />
      )}
    </div>
  )
}
