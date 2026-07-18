import fs from 'node:fs'
import path from 'node:path'
import type { ToolingPackage, ToolingReport, ToolingTool } from '@shared/types'

/** Parse the `[tools]` section of a rokit.toml (line-level, not full TOML). */
export function parseRokitToml(content: string): ToolingTool[] {
  const tools: ToolingTool[] = []
  let inTools = false
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      inTools = line === '[tools]'
      continue
    }
    if (!inTools) continue
    const match = /^([A-Za-z0-9._-]+)\s*=\s*"([^"]+)"/.exec(line)
    if (match) tools.push({ name: match[1], spec: match[2] })
  }
  return tools
}

/**
 * Parse wally.toml dependencies. Commented-out entries inside the dependency
 * sections are surfaced as `optional` (the scaffold ships genre packages that
 * way), so the tooling panel shows the whole picture.
 */
export function parseWallyToml(content: string): ToolingPackage[] {
  const packages: ToolingPackage[] = []
  let section: 'deps' | 'dev' | null = null
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      section = line === '[dependencies]' ? 'deps' : line === '[dev-dependencies]' ? 'dev' : null
      continue
    }
    if (!section || line.length === 0) continue
    const optional = line.startsWith('#')
    const body = optional ? line.replace(/^#\s*/, '') : line
    const match = /^([A-Za-z0-9._-]+)\s*=\s*"([^"]+)"\s*(?:#\s*(.*))?$/.exec(body)
    if (match) {
      packages.push({
        name: match[1],
        spec: match[2],
        comment: match[3]?.trim() || null,
        dev: section === 'dev',
        optional
      })
    }
  }
  return packages
}

/** Broad-glance tooling report for a game repo. */
export function gameTooling(repoPath: string): ToolingReport {
  const read = (file: string): string | null => {
    try {
      return fs.readFileSync(path.join(repoPath, file), 'utf8')
    } catch {
      return null
    }
  }
  const rokit = read('rokit.toml')
  const wally = read('wally.toml')
  const configs: string[] = []
  const flag = (file: string, label: string): void => {
    if (fs.existsSync(path.join(repoPath, file))) configs.push(label)
  }
  flag('default.project.json', 'Rojo project')
  flag('selene.toml', 'Selene')
  flag('stylua.toml', 'StyLua')
  flag('.luaurc', '.luaurc')
  flag(path.join('Packages'), 'Packages installed')
  return {
    tools: rokit ? parseRokitToml(rokit) : [],
    packages: wally ? parseWallyToml(wally) : [],
    configs
  }
}
