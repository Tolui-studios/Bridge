import type { Game } from '@shared/types'

interface Props {
  games: Game[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAdd: () => void
}

export default function Sidebar({ games, selectedId, onSelect, onAdd }: Props) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900/40">
      <div className="border-b border-neutral-800 px-4 py-4">
        <h1 className="text-lg font-semibold tracking-[0.35em] text-neutral-100">BRIDGE</h1>
        <p className="text-xs text-neutral-500">mission control</p>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {games.map((game) => {
          const active = game.id === selectedId
          return (
            <button
              key={game.id}
              onClick={() => onSelect(game.id)}
              className={`w-full rounded-md px-3 py-2 text-left transition-colors ${
                active
                  ? 'bg-neutral-800 text-neutral-100'
                  : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'
              }`}
            >
              <span className="block truncate text-sm font-medium">{game.name}</span>
              <span className="block truncate text-[10px] text-neutral-600">{game.repoPath}</span>
            </button>
          )
        })}
        {games.length === 0 && (
          <p className="px-2 py-3 text-xs text-neutral-600">No games registered yet.</p>
        )}
      </nav>
      <div className="border-t border-neutral-800 p-2">
        <button
          onClick={onAdd}
          className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
        >
          + Add Game
        </button>
      </div>
    </aside>
  )
}
