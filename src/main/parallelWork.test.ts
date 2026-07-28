import { describe, expect, it } from 'vitest'
import { buildParallelWorkSection } from './parallelWork'

describe('buildParallelWorkSection', () => {
  it('returns the protocol and self-sync instruction when nothing is in flight', () => {
    const section = buildParallelWorkSection([], 'main')
    expect(section).toContain('BRIDGE:CLAIM')
    expect(section).toContain('git fetch origin && git merge origin/main')
    expect(section).not.toContain('already changed or claimed')
  })

  it('interpolates the default branch into the sync instruction', () => {
    expect(buildParallelWorkSection([], 'trunk')).toContain('git merge origin/trunk')
  })

  it('lists changed and claimed files per active entry', () => {
    const section = buildParallelWorkSection(
      [
        {
          label: 'agent-2 (“fix damage sync”)',
          changedFiles: ['src/shared/types.ts', 'src/main/ipc/agents.ts'],
          claims: ['CLAUDE.md']
        }
      ],
      'main'
    )
    expect(section).toContain('already changed or claimed')
    expect(section).toContain(
      '- agent-2 (“fix damage sync”): src/shared/types.ts, src/main/ipc/agents.ts; claimed: CLAUDE.md'
    )
    expect(section).toContain('Avoid editing these files.')
  })

  it('skips entries with nothing changed or claimed', () => {
    const section = buildParallelWorkSection(
      [{ label: 'agent-3 (“idle”)', changedFiles: [], claims: [] }],
      'main'
    )
    expect(section).not.toContain('agent-3')
    expect(section).not.toContain('already changed or claimed')
  })

  it('caps long file lists with a +N more suffix', () => {
    const files = Array.from({ length: 25 }, (_, i) => `src/f${i}.luau`)
    const section = buildParallelWorkSection(
      [{ label: 'agent-2 (“big refactor”)', changedFiles: files, claims: [] }],
      'main'
    )
    expect(section).toContain('src/f19.luau (+5 more)')
    expect(section).not.toContain('src/f20.luau')
  })

  it('renders a claims-only entry (declared before touching anything)', () => {
    const section = buildParallelWorkSection(
      [{ label: 'agent-4 (“ui pass”)', changedFiles: [], claims: ['src/shared/Config.luau'] }],
      'main'
    )
    expect(section).toContain('- agent-4 (“ui pass”): claimed: src/shared/Config.luau')
  })
})
