import fs from 'node:fs'
import path from 'node:path'
import type { AppSettings } from '@shared/types'

interface SettingsFile {
  version: 1
  vaultPath: string | null
}

/** Tiny persisted app settings (currently just the vault path). */
export class SettingsStore {
  private vaultPath: string | null = null

  constructor(private readonly filePath: string) {
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as SettingsFile
      this.vaultPath = typeof data.vaultPath === 'string' ? data.vaultPath : null
    } catch {
      // Missing or corrupt settings — start with defaults.
    }
  }

  get(): AppSettings {
    return {
      vaultPath: this.vaultPath,
      vaultExists: this.vaultPath !== null && fs.existsSync(this.vaultPath)
    }
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
    const payload: SettingsFile = { version: 1, vaultPath: this.vaultPath }
    const tmp = `${this.filePath}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
    fs.renameSync(tmp, this.filePath)
  }
}
