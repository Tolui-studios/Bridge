import { describe, expect, it } from 'vitest'
import { computeOverlap, withClaims } from './worktreeOverlap'

describe('computeOverlap', () => {
  it('returns empty results for disjoint trees', () => {
    const result = computeOverlap([
      { key: 'a', files: ['src/one.luau'] },
      { key: 'b', files: ['src/two.luau'] }
    ])
    expect(result.byFile).toEqual({})
    expect(result.byKey).toEqual({})
  })

  it('reports a file touched by two trees with both holders', () => {
    const result = computeOverlap([
      { key: 'a', files: ['src/shared/Config.luau', 'src/a-only.luau'] },
      { key: 'b', files: ['src/shared/Config.luau'] }
    ])
    expect(result.byFile).toEqual({ 'src/shared/config.luau': ['a', 'b'] })
    expect(result.byKey).toEqual({
      a: ['src/shared/config.luau'],
      b: ['src/shared/config.luau']
    })
  })

  it('includes main as a holder like any worktree', () => {
    const result = computeOverlap([
      { key: 'main', files: ['GOALS.md'] },
      { key: 'C:\\wt\\agent-1', files: ['GOALS.md'] }
    ])
    expect(result.byFile['goals.md']).toEqual(['main', 'C:\\wt\\agent-1'])
  })

  it('matches case- and slash-insensitively but preserves first-seen spelling', () => {
    const result = computeOverlap([
      { key: 'a', files: ['Src\\Shared\\Config.luau'] },
      { key: 'b', files: ['src/shared/config.luau'] }
    ])
    expect(result.byFile['src/shared/config.luau']).toEqual(['a', 'b'])
    expect(result.display['src/shared/config.luau']).toBe('Src\\Shared\\Config.luau')
  })

  it('ignores duplicate paths within one tree and single-holder files', () => {
    const result = computeOverlap([
      { key: 'a', files: ['src/x.luau', 'src\\x.luau', 'src/solo.luau'] }
    ])
    expect(result.byFile).toEqual({})
    expect(result.byKey).toEqual({})
  })

  it('handles three-way overlap and fills byKey for every holder', () => {
    const result = computeOverlap([
      { key: 'main', files: ['src/hot.luau'] },
      { key: 'a', files: ['src/hot.luau', 'src/pair.luau'] },
      { key: 'b', files: ['src/hot.luau', 'src/pair.luau'] }
    ])
    expect(result.byFile['src/hot.luau']).toEqual(['main', 'a', 'b'])
    expect(result.byFile['src/pair.luau']).toEqual(['a', 'b'])
    expect(result.byKey['main']).toEqual(['src/hot.luau'])
    expect(result.byKey['a']).toEqual(['src/hot.luau', 'src/pair.luau'])
    expect(result.byKey['b']).toEqual(['src/hot.luau', 'src/pair.luau'])
  })
})

describe('withClaims', () => {
  it('merges a claim into the source with the same key — no self-conflict', () => {
    const merged = withClaims(
      [{ key: 'C:\\wt\\agent-1', files: ['src/a.luau'] }],
      [{ key: 'c:/wt/agent-1', files: ['src/a.luau', 'CLAUDE.md'] }]
    )
    expect(merged).toHaveLength(1)
    const result = computeOverlap(merged)
    // A tree claiming a file it already changed must not conflict with itself.
    expect(result.byFile).toEqual({})
  })

  it('appends a new source for a session that only declared intent', () => {
    const merged = withClaims(
      [{ key: 'C:\\wt\\agent-1', files: ['CLAUDE.md'] }],
      [{ key: 'C:\\wt\\agent-2', files: ['claude.md'] }]
    )
    expect(merged).toHaveLength(2)
    const result = computeOverlap(merged)
    expect(result.byFile['claude.md']).toEqual(['C:\\wt\\agent-1', 'C:\\wt\\agent-2'])
  })

  it('surfaces a claim colliding with another worktree’s changed file', () => {
    const merged = withClaims(
      [
        { key: 'C:\\wt\\agent-1', files: ['src/shared/Config.luau'] },
        { key: 'C:\\wt\\agent-2', files: ['src/other.luau'] }
      ],
      [{ key: 'C:\\wt\\agent-2', files: ['src/shared/config.luau'] }]
    )
    const result = computeOverlap(merged)
    expect(result.byFile['src/shared/config.luau']).toEqual(['C:\\wt\\agent-1', 'C:\\wt\\agent-2'])
  })

  it('drops empty claim lists and leaves sources untouched', () => {
    const sources = [{ key: 'a', files: ['x.ts'] }]
    const merged = withClaims(sources, [{ key: 'b', files: [] }])
    expect(merged).toEqual([{ key: 'a', files: ['x.ts'] }])
    // And never mutates the caller's arrays.
    expect(sources[0].files).toEqual(['x.ts'])
  })
})
