import { webContents } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { IPC } from '@shared/ipc-channels'
import { mutateGoalsContent } from '@shared/goalsMutator'
import type {
  AgentSessionSummary,
  Game,
  GoalsMutation,
  GoalsState,
  TeamConnectInput,
  TeamNoteState,
  TeamRemoteSession,
  TeamState,
  TeamStatus,
  TeamUserPresence
} from '@shared/types'
import type { SettingsStore } from './settings'
import type { GoalsService } from './goals'
import { normalizeRemoteKey, remoteUrl } from './gitOps'

interface GoalsRow {
  game_key: string
  content: string
  version: number
  updated_by: string | null
}

interface NoteRow {
  game_key: string
  content: string
  version: number
  updated_by: string | null
  updated_at: string | null
}

interface SessionRow {
  id: string
  game_key: string
  owner: string
  summary: Partial<AgentSessionSummary>
  updated_at: string | null
}

interface PresencePayload {
  name: string
  gameKey: string | null
  agents: number
}

export interface TeamSyncDeps {
  settings: SettingsStore
  authStorePath: string
  listGames: () => Game[]
  getGame: (id: string) => Game | undefined
  goals: GoalsService
  getLiveAgentCount: () => number
}

/**
 * Setup B: the shared coordination layer. A Supabase project carries what
 * must be common across operators — presence (who is on which game),
 * canonical goals content (the single-writer rule moves here when a game is
 * synced), the per-game team note, and live agent session summaries. Code
 * never flows through it; agents and repos stay local, merged via git.
 * Everything degrades to local-only behavior when offline/unconfigured.
 */
export class TeamSync {
  private client: SupabaseClient | null = null
  private channel: RealtimeChannel | null = null
  private status: TeamStatus = 'off'
  private reason: string | null = null
  private me: string | null = null
  private focusGameId: string | null = null
  private users: TeamUserPresence[] = []
  private sessions = new Map<string, TeamRemoteSession>()
  private gameKeys = new Map<string, string | null>()

  constructor(private readonly deps: TeamSyncDeps) {}

  // ---------------------------------------------------------------- lifecycle

  /** Try to restore a previous login from the stored session at app start. */
  async restore(): Promise<void> {
    const config = this.deps.settings.getTeamConfig()
    if (!config) return
    this.setStatus('connecting', null)
    try {
      const client = this.makeClient(config.url, config.anonKey)
      const { data } = await client.auth.getSession()
      if (!data.session) {
        this.setStatus('error', 'Signed out — reconnect with your team password.')
        return
      }
      this.client = client
      this.me = displayName(data.session.user?.email ?? config.email)
      await this.initAfterAuth()
    } catch (err) {
      this.setStatus('error', errMessage(err))
    }
  }

  async connect(input: TeamConnectInput): Promise<TeamState> {
    await this.teardown()
    this.setStatus('connecting', null)
    try {
      const url = input.url.trim().replace(/\/+$/, '')
      const client = this.makeClient(url, input.anonKey.trim())
      const { data, error } = await client.auth.signInWithPassword({
        email: input.email.trim(),
        password: input.password
      })
      if (error || !data.session) {
        throw new Error(error?.message ?? 'Sign-in failed.')
      }
      this.deps.settings.setTeamConfig({
        url,
        anonKey: input.anonKey.trim(),
        email: input.email.trim()
      })
      this.client = client
      this.me = displayName(data.session.user?.email ?? input.email)
      await this.initAfterAuth()
    } catch (err) {
      this.setStatus('error', errMessage(err))
    }
    return this.state()
  }

  async disconnect(): Promise<TeamState> {
    try {
      await this.client?.auth.signOut()
    } catch {
      // Best-effort.
    }
    await this.teardown()
    this.setStatus('off', null)
    return this.state()
  }

  state(): TeamState {
    return {
      status: this.status,
      reason: this.reason,
      me: this.me,
      users: [...this.users],
      sessions: [...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt)
    }
  }

  // ---------------------------------------------------------------- presence

  async setFocus(gameId: string | null): Promise<void> {
    this.focusGameId = gameId
    await this.trackPresence()
  }

  async refreshPresence(): Promise<void> {
    await this.trackPresence()
  }

  // ---------------------------------------------------------------- goals

  /**
   * Team-canonical goals mutation with optimistic concurrency. Returns the
   * fresh local state, or null when this game is not synced (caller falls
   * back to the local single writer).
   */
  async mutateGoals(game: Game, mutation: GoalsMutation): Promise<GoalsState | null> {
    if (this.status !== 'online' || !this.client) return null
    const key = await this.keyFor(game)
    if (!key) return null

    for (let attempt = 0; attempt < 2; attempt++) {
      const row = await this.fetchGoalsRow(key)
      const base = row?.content ?? this.deps.goals.readRaw(game)
      if (base === null || base === undefined) {
        throw new Error('GOALS.md does not exist yet. Create it from the template first.')
      }
      const result = mutateGoalsContent(base, mutation)
      if (!result.ok) throw new Error(result.error)
      if (!row) {
        await this.ensureGameRow(key, game.name)
        const { error } = await this.client
          .from('goals')
          .insert({ game_key: key, content: result.content, version: 1, updated_by: this.me })
        if (!error) return this.deps.goals.writeProjection(game, result.content)
        continue // Someone else inserted first — retry against their row.
      }
      const { data, error } = await this.client
        .from('goals')
        .update({ content: result.content, version: row.version + 1, updated_by: this.me })
        .eq('game_key', key)
        .eq('version', row.version)
        .select('game_key')
      if (error) throw new Error(error.message)
      if (data && data.length > 0) {
        return this.deps.goals.writeProjection(game, result.content)
      }
      // Version moved under us — loop re-reads and re-applies (expectText
      // guards inside the mutation keep the edit semantically safe).
    }
    throw new Error('Goals changed concurrently on the team — try again.')
  }

  /** Push a locally-edited GOALS.md (external editor) up as the new canon. */
  async pushLocalEdit(game: Game, raw: string): Promise<void> {
    if (this.status !== 'online' || !this.client) return
    const key = await this.keyFor(game)
    if (!key) return
    try {
      const row = await this.fetchGoalsRow(key)
      if (row?.content === raw) return
      await this.ensureGameRow(key, game.name)
      if (!row) {
        await this.client
          .from('goals')
          .insert({ game_key: key, content: raw, version: 1, updated_by: this.me })
      } else {
        await this.client
          .from('goals')
          .update({ content: raw, version: row.version + 1, updated_by: this.me })
          .eq('game_key', key)
          .eq('version', row.version)
      }
    } catch {
      // Offline blips are fine; next edit retries.
    }
  }

  // ---------------------------------------------------------------- notes

  async getNote(game: Game): Promise<TeamNoteState | null> {
    if (this.status !== 'online' || !this.client) return null
    const key = await this.keyFor(game)
    if (!key) return null
    const { data, error } = await this.client
      .from('notes')
      .select('*')
      .eq('game_key', key)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return { content: '', version: 0, updatedBy: null, updatedAt: null }
    return noteState(data as NoteRow)
  }

  async saveNote(game: Game, content: string, baseVersion: number): Promise<TeamNoteState> {
    if (this.status !== 'online' || !this.client) throw new Error('Team sync is offline.')
    const key = await this.keyFor(game)
    if (!key) throw new Error('This game has no git remote, so it cannot be team-synced.')
    await this.ensureGameRow(key, game.name)
    if (baseVersion === 0) {
      const { error } = await this.client
        .from('notes')
        .insert({ game_key: key, content, version: 1, updated_by: this.me })
      if (!error) return { content, version: 1, updatedBy: this.me, updatedAt: Date.now() }
      // Row exists — fall through to CAS update against the current version.
    }
    const { data: current } = await this.client
      .from('notes')
      .select('*')
      .eq('game_key', key)
      .maybeSingle()
    const row = current as NoteRow | null
    const version = row?.version ?? 0
    const { data, error } = await this.client
      .from('notes')
      .update({ content, version: version + 1, updated_by: this.me })
      .eq('game_key', key)
      .eq('version', version)
      .select('*')
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) {
      throw new Error('The note was just changed by someone else — reload it first.')
    }
    return noteState(data[0] as NoteRow)
  }

  // ---------------------------------------------------------------- sessions

  publishSession(summary: AgentSessionSummary): void {
    if (this.status !== 'online' || !this.client) return
    void (async () => {
      try {
        const game = this.deps.getGame(summary.gameId)
        if (!game) return
        const key = await this.keyFor(game)
        if (!key || !this.client) return
        await this.client.from('sessions').upsert(
          {
            id: summary.id,
            game_key: key,
            owner: this.me ?? 'unknown',
            summary: {
              task: summary.task,
              status: summary.status,
              numTurns: summary.numTurns,
              costUsd: summary.costUsd,
              startedAt: summary.startedAt
            }
          },
          { onConflict: 'id' }
        )
        await this.trackPresence()
      } catch {
        // Mirroring is best-effort.
      }
    })()
  }

  onGameAdded(game: Game): void {
    void (async () => {
      const key = await this.keyFor(game)
      if (key && this.status === 'online') await this.ensureGameRow(key, game.name)
    })()
  }

  // ---------------------------------------------------------------- internals

  private makeClient(url: string, anonKey: string): SupabaseClient {
    const storePath = this.deps.authStorePath
    const readStore = (): Record<string, string> => {
      try {
        return JSON.parse(fs.readFileSync(storePath, 'utf8')) as Record<string, string>
      } catch {
        return {}
      }
    }
    const storage = {
      getItem: (key: string): string | null => readStore()[key] ?? null,
      setItem: (key: string, value: string): void => {
        const store = readStore()
        store[key] = value
        fs.mkdirSync(path.dirname(storePath), { recursive: true })
        fs.writeFileSync(storePath, JSON.stringify(store), 'utf8')
      },
      removeItem: (key: string): void => {
        const store = readStore()
        delete store[key]
        try {
          fs.writeFileSync(storePath, JSON.stringify(store), 'utf8')
        } catch {
          // Best-effort.
        }
      }
    }
    return createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storage }
    })
  }

  private async initAfterAuth(): Promise<void> {
    if (!this.client) return
    await this.resolveAllGameKeys()
    await this.registerGames()
    await this.loadInitialSessions()
    await this.pullAllGoals()
    this.openChannel()
  }

  private openChannel(): void {
    if (!this.client) return
    const channel = this.client.channel('bridge-team', {
      config: { presence: { key: this.me ?? 'unknown' } }
    })
    channel.on('presence', { event: 'sync' }, () => {
      this.readPresence(channel)
      this.publishState()
    })
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'goals' },
      (payload) => void this.onGoalsChange(payload.new as Partial<GoalsRow>)
    )
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notes' },
      (payload) => this.onNoteChange(payload.new as Partial<NoteRow>)
    )
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'sessions' },
      (payload) => this.onSessionChange(payload.new as Partial<SessionRow>)
    )
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        this.setStatus('online', null)
        void this.trackPresence()
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        this.setStatus('error', `Realtime channel ${status.toLowerCase().replace('_', ' ')}.`)
      } else if (status === 'CLOSED' && this.status === 'online') {
        this.setStatus('connecting', 'Reconnecting…')
      }
    })
    this.channel = channel
  }

  private async trackPresence(): Promise<void> {
    if (!this.channel || this.status !== 'online') return
    const focusGame = this.focusGameId ? this.deps.getGame(this.focusGameId) : undefined
    const gameKey = focusGame ? await this.keyFor(focusGame) : null
    const payload: PresencePayload = {
      name: this.me ?? 'unknown',
      gameKey,
      agents: this.deps.getLiveAgentCount()
    }
    try {
      await this.channel.track(payload)
    } catch {
      // Presence is best-effort.
    }
  }

  private readPresence(channel: RealtimeChannel): void {
    const state = channel.presenceState<PresencePayload>()
    const users: TeamUserPresence[] = []
    for (const entries of Object.values(state)) {
      const latest = entries[entries.length - 1]
      if (!latest) continue
      users.push({
        name: latest.name,
        gameKey: latest.gameKey,
        gameId: latest.gameKey ? this.gameIdForKey(latest.gameKey) : null,
        agents: latest.agents ?? 0
      })
    }
    this.users = users
  }

  private async onGoalsChange(row: Partial<GoalsRow>): Promise<void> {
    if (!row?.game_key || typeof row.content !== 'string') return
    const gameId = this.gameIdForKey(row.game_key)
    if (!gameId) return
    const game = this.deps.getGame(gameId)
    if (!game) return
    if (this.deps.goals.readRaw(game) === row.content) return
    // Writing the projection triggers the goals watcher, which refreshes the UI.
    this.deps.goals.writeProjection(game, row.content)
  }

  private onNoteChange(row: Partial<NoteRow>): void {
    if (!row?.game_key || typeof row.content !== 'string') return
    const gameId = this.gameIdForKey(row.game_key)
    if (!gameId) return
    for (const wc of webContents.getAllWebContents()) {
      wc.send(IPC.EvTeamNote, { gameId, note: noteState(row as NoteRow) })
    }
  }

  private onSessionChange(row: Partial<SessionRow>): void {
    if (!row?.id || !row.game_key) return
    this.sessions.set(row.id, sessionState(row as SessionRow, this.gameIdForKey(row.game_key)))
    this.publishState()
  }

  private async loadInitialSessions(): Promise<void> {
    if (!this.client) return
    try {
      const { data } = await this.client
        .from('sessions')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(100)
      this.sessions.clear()
      for (const raw of (data ?? []) as SessionRow[]) {
        this.sessions.set(raw.id, sessionState(raw, this.gameIdForKey(raw.game_key)))
      }
    } catch {
      // Non-fatal.
    }
  }

  /** On (re)connect, adopt team-canonical goals for every synced game. */
  private async pullAllGoals(): Promise<void> {
    if (!this.client) return
    for (const game of this.deps.listGames()) {
      const key = this.gameKeys.get(game.id)
      if (!key) continue
      try {
        const row = await this.fetchGoalsRow(key)
        const local = this.deps.goals.readRaw(game)
        if (row && row.content !== local) {
          this.deps.goals.writeProjection(game, row.content)
        } else if (!row && local) {
          await this.ensureGameRow(key, game.name)
          await this.client
            .from('goals')
            .insert({ game_key: key, content: local, version: 1, updated_by: this.me })
        }
      } catch {
        // Per-game best effort.
      }
    }
  }

  private async fetchGoalsRow(key: string): Promise<GoalsRow | null> {
    if (!this.client) return null
    const { data, error } = await this.client
      .from('goals')
      .select('*')
      .eq('game_key', key)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return (data as GoalsRow | null) ?? null
  }

  private async ensureGameRow(key: string, name: string): Promise<void> {
    if (!this.client) return
    await this.client.from('games').upsert({ key, name }, { onConflict: 'key' })
  }

  private async registerGames(): Promise<void> {
    for (const game of this.deps.listGames()) {
      const key = this.gameKeys.get(game.id)
      if (key) await this.ensureGameRow(key, game.name)
    }
  }

  private async resolveAllGameKeys(): Promise<void> {
    for (const game of this.deps.listGames()) {
      await this.keyFor(game)
    }
  }

  private async keyFor(game: Game): Promise<string | null> {
    if (this.gameKeys.has(game.id)) return this.gameKeys.get(game.id) ?? null
    const key = normalizeRemoteKey(await remoteUrl(game))
    this.gameKeys.set(game.id, key)
    return key
  }

  private gameIdForKey(key: string): string | null {
    for (const [gameId, gameKey] of this.gameKeys) {
      if (gameKey === key && this.deps.getGame(gameId)) return gameId
    }
    return null
  }

  private async teardown(): Promise<void> {
    if (this.channel && this.client) {
      try {
        await this.client.removeChannel(this.channel)
      } catch {
        // Best-effort.
      }
    }
    this.channel = null
    this.client = null
    this.users = []
    this.sessions.clear()
    this.me = null
  }

  private setStatus(status: TeamStatus, reason: string | null): void {
    this.status = status
    this.reason = reason
    this.publishState()
  }

  private publishState(): void {
    const state = this.state()
    for (const wc of webContents.getAllWebContents()) {
      wc.send(IPC.EvTeamChanged, state)
    }
  }
}

function displayName(email: string): string {
  const at = email.indexOf('@')
  return at > 0 ? email.slice(0, at) : email
}

function noteState(row: NoteRow): TeamNoteState {
  return {
    content: row.content,
    version: row.version,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at ? Date.parse(row.updated_at) : null
  }
}

function sessionState(row: SessionRow, gameId: string | null): TeamRemoteSession {
  const summary = row.summary ?? {}
  return {
    id: row.id,
    gameId,
    gameKey: row.game_key,
    owner: row.owner,
    task: typeof summary.task === 'string' ? summary.task : '(unknown task)',
    status: (summary.status as TeamRemoteSession['status']) ?? 'done',
    numTurns: typeof summary.numTurns === 'number' ? summary.numTurns : null,
    costUsd: typeof summary.costUsd === 'number' ? summary.costUsd : null,
    updatedAt: row.updated_at ? Date.parse(row.updated_at) : Date.now()
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
