import type { Game } from '@shared/types'
import UsageBar from './UsageBar'
import TeamBlock from './TeamBlock'
import { useSettings } from '../hooks/useVault'
import { useTeam } from '../hooks/useTeam'

interface Props {
  games: Game[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAdd: () => void
}

export default function Sidebar({ games, selectedId, onSelect, onAdd }: Props) {
  const { team } = useTeam()
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900/40">
      <div className="border-b border-neutral-800 px-4 py-4">
        <h1 className="text-lg font-semibold tracking-[0.35em] text-neutral-100">BRIDGE</h1>
        <p className="text-xs text-neutral-500">mission control</p>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {games.map((game) => {
          const active = game.id === selectedId
          const others = team.users.filter((u) => u.gameId === game.id && u.name !== team.me)
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
              <span className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{game.name}</span>
                {others.map((user) => (
                  <span
                    key={user.name}
                    title={`${user.name} is working on this project${user.agents > 0 ? ` (${user.agents} agent${user.agents > 1 ? 's' : ''})` : ''}`}
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-[8px] font-bold uppercase text-amber-300 ring-1 ring-amber-500/40"
                  >
                    {user.name.slice(0, 2)}
                  </span>
                ))}
              </span>
              <span className="block truncate text-[10px] text-neutral-600">{game.repoPath}</span>
            </button>
          )
        })}
        {games.length === 0 && (
          <p className="px-2 py-3 text-xs text-neutral-600">No games registered yet.</p>
        )}
      </nav>
      <TeamBlock />
      <VaultRow />
      <UsageBar />
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

function vaultBasename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

function VaultRow() {
  const { settings, connectVault, disconnectVault, openVault, error } = useSettings()
  if (!settings) return null
  return (
    <div className="border-t border-neutral-800 px-4 py-3">
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
        Vault
      </span>
      {settings.vaultPath ? (
        <div className="flex items-center gap-1.5">
          <button
            onClick={openVault}
            title={`${settings.vaultPath}${settings.vaultExists ? '' : ' (folder missing!)'} — click to open`}
            className="min-w-0 flex-1 truncate text-left text-[11px] text-neutral-400 transition-colors hover:text-neutral-200"
          >
            {vaultBasename(settings.vaultPath)}
            {!settings.vaultExists && <span className="text-red-400"> · missing</span>}
          </button>
          <button
            onClick={() => void connectVault()}
            title="Change vault folder"
            className="shrink-0 rounded px-1 text-[11px] text-neutral-600 hover:bg-neutral-800 hover:text-neutral-300"
          >
            ✎
          </button>
          <button
            onClick={() => void disconnectVault()}
            title="Disconnect vault"
            className="shrink-0 rounded px-1 text-[11px] text-neutral-600 hover:bg-neutral-800 hover:text-red-400"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          onClick={() => void connectVault()}
          className="w-full rounded-md border border-dashed border-neutral-700 px-3 py-1.5 text-[11px] text-neutral-500 transition-colors hover:border-neutral-500 hover:text-neutral-300"
        >
          Connect Obsidian vault
        </button>
      )}
      {error && <p className="mt-1 text-[10px] text-red-400">{error}</p>}
    </div>
  )
}
