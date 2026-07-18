import fs from 'node:fs'
import path from 'node:path'
import type { AppSettings } from '@shared/types'

export interface TeamConfig {
  url: string
  anonKey: string
  email: string
}

interface SettingsFile {
  version: 1
  vaultPath: string | null
  team?: TeamConfig | null
}

/** Tiny persisted app settings: vault path + team sync config. */
export class SettingsStore {
  private vaultPath: string | null = null
  private team: TeamConfig | null = null

  constructor(private readonly filePath: string) {
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as SettingsFile
      this.vaultPath = typeof data.vaultPath === 'string' ? data.vaultPath : null
      if (data.team && typeof data.team.url === 'string' && typeof data.team.anonKey === 'string') {
        this.team = { url: data.team.url, anonKey: data.team.anonKey, email: data.team.email ?? '' }
      }
    } catch {
      // Missing or corrupt settings — start with defaults.
    }
  }

  get(): AppSettings {
    return {
      vaultPath: this.vaultPath,
      vaultExists: this.vaultPath !== null && fs.existsSync(this.vaultPath),
      teamConfigured: this.team !== null,
      teamUrl: this.team?.url ?? null,
      teamEmail: this.team?.email ?? null
    }
  }

  getTeamConfig(): TeamConfig | null {
    return this.team ? { ...this.team } : null
  }

  setTeamConfig(config: TeamConfig | null): AppSettings {
    this.team = config ? { ...config } : null
    this.save()
    return this.get()
  }

  setVaultPath(rawPath: string | null): AppSettings {
    if (rawPath !== null) {
      const resolved = path.resolve(rawPath.trim())
      let stat: fs.Stats
      try {
        stat = fs.statSync(resolved)
      } catch {
        throw new Error(`Vault folder does not exist: ${resolved}`)
      }
      if (!stat.isDirectory()) throw new Error(`Vault path is not a folder: ${resolved}`)
      this.vaultPath = resolved
    } else {
      this.vaultPath = null
    }
    this.save()
    return this.get()
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    const payload: SettingsFile = { version: 1, vaultPath: this.vaultPath, team: this.team }
    const tmp = `${this.filePath}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
    fs.renameSync(tmp, this.filePath)
  }
}
