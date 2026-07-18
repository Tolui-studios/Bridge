import { useState } from 'react'
import type { TeamState } from '@shared/types'
import { TEAM_DEFAULTS } from '@shared/teamDefaults'
import { useTeam } from '../hooks/useTeam'
import { useSettings } from '../hooks/useVault'

const STATUS_DOT: Record<TeamState['status'], string> = {
  off: 'bg-neutral-700',
  connecting: 'bg-amber-400 animate-pulse',
  online: 'bg-emerald-500',
  error: 'bg-red-500'
}

/** Sidebar block: team sync status, online teammates, connect/disconnect. */
export default function TeamBlock() {
  const { team, connect, disconnect, error, clearError } = useTeam()
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <div className="border-t border-neutral-800 px-4 py-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
          Team
        </span>
        <span className={`h-2 w-2 rounded-full ${STATUS_DOT[team.status]}`} title={team.status} />
      </div>

      {team.status === 'online' ? (
        <div className="space-y-1">
          {team.users.map((user) => (
            <div key={user.name} className="flex items-center gap-1.5 text-[11px]">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-neutral-700 text-[8px] font-bold uppercase text-neutral-200">
                {user.name.slice(0, 2)}
              </span>
              <span className={user.name === team.me ? 'text-neutral-200' : 'text-neutral-400'}>
                {user.name}
                {user.name === team.me ? ' (you)' : ''}
              </span>
              {user.agents > 0 && (
                <span className="text-[9px] text-amber-400">{user.agents} agent{user.agents > 1 ? 's' : ''}</span>
              )}
            </div>
          ))}
          <button
            onClick={() => void disconnect()}
            className="mt-1 text-[10px] text-neutral-600 hover:text-neutral-400"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <>
          <button
            onClick={() => setModalOpen(true)}
            className="w-full rounded-md border border-dashed border-neutral-700 px-3 py-1.5 text-[11px] text-neutral-500 transition-colors hover:border-neutral-500 hover:text-neutral-300"
          >
            {team.status === 'connecting' ? 'Connecting…' : 'Sign in to team'}
          </button>
          {(team.reason || error) && (
            <p className="mt-1 text-[10px] leading-snug text-red-400" title={team.reason ?? error ?? ''}>
              {team.reason ?? error}
            </p>
          )}
        </>
      )}

      {modalOpen && (
        <ConnectModal
          onClose={() => {
            setModalOpen(false)
            clearError()
          }}
          onConnect={async (input) => {
            const state = await connect(input)
            if (state.status === 'online') setModalOpen(false)
            return state
          }}
        />
      )}
    </div>
  )
}

function ConnectModal({
  onClose,
  onConnect
}: {
  onClose: () => void
  onConnect: (input: {
    url?: string
    anonKey?: string
    email: string
    password: string
  }) => Promise<TeamState>
}) {
  const { settings } = useSettings()
  // A server is already known when it's baked into the build or was used
  // on this machine before — then teammates only need email + password.
  const knownServer = Boolean(TEAM_DEFAULTS.url || settings?.teamUrl)
  const [email, setEmail] = useState(settings?.teamEmail ?? '')
  const [password, setPassword] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(!knownServer)
  const [url, setUrl] = useState('')
  const [anonKey, setAnonKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    if (busy || !email.trim() || !password) return
    setBusy(true)
    setError(null)
    try {
      const state = await onConnect({
        email,
        password,
        ...(url.trim() ? { url } : {}),
        ...(anonKey.trim() ? { anonKey } : {})
      })
      if (state.status !== 'online') setError(state.reason ?? 'Could not connect.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const field =
    'w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-emerald-600'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-neutral-100">Sign in to your team</h3>
        <p className="mt-1 text-xs text-neutral-500">
          {knownServer
            ? 'Your studio account — the server is already configured.'
            : 'First-time setup: this build has no studio server yet (see docs/TEAM-SYNC.md).'}
        </p>
        <div className="mt-5 space-y-3">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@studio.com"
            className={field}
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            placeholder="password"
            className={field}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
          />
          {showAdvanced ? (
            <div className="space-y-3 border-t border-neutral-800 pt-3">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={settings?.teamUrl ?? TEAM_DEFAULTS.url ?? 'https://xxxx.supabase.co'}
                title="Supabase project URL (leave blank to use the configured server)"
                className={field}
              />
              <input
                value={anonKey}
                onChange={(e) => setAnonKey(e.target.value)}
                placeholder={knownServer ? 'anon key (blank = configured key)' : 'anon public key'}
                className={field}
              />
            </div>
          ) : (
            <button
              onClick={() => setShowAdvanced(true)}
              className="text-[10px] text-neutral-600 hover:text-neutral-400"
            >
              Advanced: change server…
            </button>
          )}
        </div>
        {error && (
          <p className="mt-4 rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy || !email.trim() || !password}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </div>
    </div>
  )
}
