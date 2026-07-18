import { describe, expect, it } from 'vitest'
import { pickRokitAsset } from './toolchain'

const ASSETS = [
  'rokit-1.2.0-linux-aarch64.zip',
  'rokit-1.2.0-linux-x86_64.zip',
  'rokit-1.2.0-macos-aarch64.zip',
  'rokit-1.2.0-macos-x86_64.zip',
  'rokit-1.2.0-windows-aarch64.zip',
  'rokit-1.2.0-windows-x86_64.zip'
]

describe('pickRokitAsset', () => {
  it('matches windows x64', () => {
    expect(pickRokitAsset(ASSETS, 'win32', 'x64')).toBe('rokit-1.2.0-windows-x86_64.zip')
  })

  it('matches apple silicon and intel macs', () => {
    expect(pickRokitAsset(ASSETS, 'darwin', 'arm64')).toBe('rokit-1.2.0-macos-aarch64.zip')
    expect(pickRokitAsset(ASSETS, 'darwin', 'x64')).toBe('rokit-1.2.0-macos-x86_64.zip')
  })

  it('returns null when nothing fits', () => {
    expect(pickRokitAsset(['rokit-1.2.0-linux-x86_64.zip'], 'win32', 'x64')).toBeNull()
    expect(pickRokitAsset([], 'darwin', 'arm64')).toBeNull()
  })
})
