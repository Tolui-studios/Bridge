import { useState } from 'react'
import type { Game } from '@shared/types'
import UsageBar from './UsageBar'
import TeamBlock from './TeamBlock'
import { useSettings } from '../hooks/useVault'
import { useTeam } from '../hooks/useTeam'
import { useUpdate } from '../hooks/useUpdate'
import { cleanIpcError } from '../lib/ipcError'

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
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs text-neutral-500">mission control</p>
          <VersionTag />
        </div>
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
        <TeamGamesSection />
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

/** Running version, plus a dot when a newer one is downloaded and waiting. */
function VersionTag() {
  const update = useUpdate()
  if (!update) return null

  const pending = update.status === 'ready'
  const title = pending
    ? `Version ${update.currentVersion} — ${update.version} installs when you close Bridge`
    : update.status === 'disabled'
      ? `Version ${update.currentVersion} — auto-update off (${update.reason ?? 'unavailable'})`
      : `Version ${update.currentVersion}`

  return (
    <span title={title} className="flex shrink-0 items-center gap-1 text-[10px] text-neutral-600">
      v{update.currentVersion}
      {pending && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
    </span>
  )
}

/** Shared games this machine hasn't linked yet — locate a clone or clone fresh. */
function TeamGamesSection() {
  const { team } = useTeam()
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const unlinked = team.games.filter((g) => !g.linked)
  if (team.status !== 'online' || unlinked.length === 0) return null

  const link = (key: string, mode: 'locate' | 'clone'): void => {
    setError(null)
    setNotice(null)
    void (async () => {
      // Locate needs the user to point at the existing clone; Clone goes
      // straight into the games folder with no picker.
      let picked = ''
      if (mode === 'locate') {
        const chosen = await window.bridge.pickFolder()
        if (!chosen) return
        picked = chosen
      }
      setBusyKey(key)
      try {
        const result = await window.bridge.linkTeamGame(key, mode, picked)
        if (result.warnings.length > 0) setNotice(result.warnings.join(' '))
      } catch (err) {
        setError(cleanIpcError(err))
      } finally {
        setBusyKey(null)
      }
    })()
  }

  return (
    <div className="mt-3 border-t border-neutral-900 px-1 pt-2">
      <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-600">
        Team games
      </p>
      {unlinked.map((game) => (
        <div key={game.key} className="rounded-md px-2 py-1.5 hover:bg-neutral-900/60">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-neutral-500">☁</span>
            <span className="min-w-0 flex-1 truncate text-xs text-neutral-400" title={game.key}>
              {game.name}
            </span>
          </div>
          <div className="mt-1 flex gap-1.5">
            <button
              onClick={() => link(game.key, 'locate')}
              disabled={busyKey !== null}
              title="Point at a folder where this repo is already cloned"
              className="rounded border border-neutral-800 px-2 py-0.5 text-[10px] text-neutral-500 hover:border-neutral-600 hover:text-neutral-300 disabled:opacity-40"
            >
              Locate…
            </button>
            <button
              onClick={() => link(game.key, 'clone')}
              disabled={busyKey !== null}
              title="Clone the repo from GitHub into your games folder"
              className="rounded border border-neutral-800 px-2 py-0.5 text-[10px] text-neutral-500 hover:border-emerald-800 hover:text-emerald-400 disabled:opacity-40"
            >
              {busyKey === game.key ? 'Cloning…' : 'Clone'}
            </button>
          </div>
        </div>
      ))}
      {error && <p className="mt-1 px-2 text-[10px] leading-snug text-red-400">{error}</p>}
      {notice && <p className="mt-1 px-2 text-[10px] leading-snug text-neutral-500">{notice}</p>}
    </div>
  )
}

function vaultBasename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

function VaultRow() {
  const { settings, connectVault, disconnectVault, openVault, changeGamesRoot, openGamesRoot, error } =
    useSettings()
  if (!settings) return null
  return (
    <div className="border-t border-neutral-800 px-4 py-3">
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
        Games folder
      </span>
      <div className="mb-3 flex items-center gap-1.5">
        <button
          onClick={openGamesRoot}
          title={`${settings.gamesRoot} — cloned team games land here; click to open`}
          className="min-w-0 flex-1 truncate text-left text-[11px] text-neutral-400 transition-colors hover:text-neutral-200"
        >
          {vaultBasename(settings.gamesRoot)}
        </button>
        <button
          onClick={() => void changeGamesRoot()}
          title="Change the games folder"
          className="shrink-0 rounded px-1 text-[11px] text-neutral-600 hover:bg-neutral-800 hover:text-neutral-300"
        >
          ✎
        </button>
      </div>
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
