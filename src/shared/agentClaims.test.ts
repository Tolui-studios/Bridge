import { describe, expect, it } from 'vitest'
import { parseClaimPaths, unionClaims } from './agentClaims'

describe('parseClaimPaths', () => {
  it('splits on commas and whitespace', () => {
    expect(parseClaimPaths('src/a.luau, src/b.luau  src/c.luau')).toEqual([
      'src/a.luau',
      'src/b.luau',
      'src/c.luau'
    ])
  })

  it('normalizes backslashes and leading ./', () => {
    expect(parseClaimPaths('src\\shared\\Config.luau ./src/other.luau')).toEqual([
      'src/shared/Config.luau',
      'src/other.luau'
    ])
  })

  it('dedupes case-insensitively keeping the first spelling', () => {
    expect(parseClaimPaths('CLAUDE.md, claude.md, Claude.MD')).toEqual(['CLAUDE.md'])
  })

  it('rejects absolute paths and .. escapes', () => {
    expect(parseClaimPaths('/etc/passwd C:/repo/file.ts c:\\x.ts ../outside.ts a/../../b.ts')).toEqual(
      []
    )
    // A .. rejection must not take valid siblings down with it.
    expect(parseClaimPaths('../nope.ts, src/ok.ts')).toEqual(['src/ok.ts'])
  })

  it('returns empty for empty or junk payloads', () => {
    expect(parseClaimPaths('')).toEqual([])
    expect(parseClaimPaths('  , ,  ')).toEqual([])
  })

  it('caps the number of paths per marker', () => {
    const payload = Array.from({ length: 50 }, (_, i) => `src/f${i}.luau`).join(', ')
    expect(parseClaimPaths(payload)).toHaveLength(32)
  })

  it('drops absurdly long single paths', () => {
    expect(parseClaimPaths(`src/${'x'.repeat(300)}.luau`)).toEqual([])
  })
})

describe('unionClaims', () => {
  it('appends new paths and keeps existing order', () => {
    expect(unionClaims(['a.ts'], ['b.ts', 'c.ts'])).toEqual(['a.ts', 'b.ts', 'c.ts'])
  })

  it('skips case-insensitive duplicates, keeping the first spelling', () => {
    expect(unionClaims(['CLAUDE.md'], ['claude.md', 'src/x.ts'])).toEqual(['CLAUDE.md', 'src/x.ts'])
  })

  it('caps total claims per session', () => {
    const existing = Array.from({ length: 128 }, (_, i) => `f${i}.ts`)
    expect(unionClaims(existing, ['overflow.ts'])).toHaveLength(128)
  })
})
