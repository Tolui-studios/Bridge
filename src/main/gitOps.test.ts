import { describe, expect, it } from 'vitest'
import { normalizeRemoteKey, parseAheadBehind, toWebUrl } from './gitOps'

describe('normalizeRemoteKey', () => {
  it('maps ssh and https forms of the same repo to one key', () => {
    const expected = 'github.com/tolui-studios/bridge'
    expect(normalizeRemoteKey('git@github.com:Tolui-studios/Bridge.git')).toBe(expected)
    expect(normalizeRemoteKey('https://github.com/Tolui-studios/Bridge.git')).toBe(expected)
    expect(normalizeRemoteKey('https://github.com/Tolui-studios/Bridge')).toBe(expected)
    expect(normalizeRemoteKey('ssh://git@github.com/Tolui-studios/Bridge.git')).toBe(expected)
  })

  it('returns null for missing or unusable urls', () => {
    expect(normalizeRemoteKey(null)).toBeNull()
    expect(normalizeRemoteKey('')).toBeNull()
  })
})

describe('toWebUrl', () => {
  it('builds an https url preserving repo casing', () => {
    expect(toWebUrl('git@github.com:Tolui-studios/Bridge.git')).toBe(
      'https://github.com/Tolui-studios/Bridge'
    )
    expect(toWebUrl('https://github.com/Tolui-studios/Bridge.git')).toBe(
      'https://github.com/Tolui-studios/Bridge'
    )
  })

  it('returns null when there is no remote', () => {
    expect(toWebUrl(null)).toBeNull()
  })
})

describe('parseAheadBehind', () => {
  it('parses left-right counts', () => {
    expect(parseAheadBehind('2\t5\n')).toEqual({ ahead: 2, behind: 5 })
    expect(parseAheadBehind('0\t0')).toEqual({ ahead: 0, behind: 0 })
    expect(parseAheadBehind('garbage')).toEqual({ ahead: 0, behind: 0 })
  })
})
