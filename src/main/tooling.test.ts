import { describe, expect, it } from 'vitest'
import { parseRokitToml, parseWallyToml } from './tooling'

describe('parseRokitToml', () => {
  it('reads the tools section only', () => {
    const tools = parseRokitToml(
      ['[other]', 'x = "y"', '[tools]', 'rojo = "rojo-rbx/rojo@7.6.1"', 'lune = "lune-org/lune@0.10.4"'].join('\n')
    )
    expect(tools).toEqual([
      { name: 'rojo', spec: 'rojo-rbx/rojo@7.6.1' },
      { name: 'lune', spec: 'lune-org/lune@0.10.4' }
    ])
  })
})

describe('parseWallyToml', () => {
  it('reads deps, dev-deps, comments, and commented-out optionals', () => {
    const packages = parseWallyToml(
      [
        '[package]',
        'name = "tolui-studios/game"',
        '[dependencies]',
        '# CORE',
        'ByteNet = "ffrostflame/bytenet@0.4.6"             # client<->server networking',
        '# FastCast = "megamonsta2/fastcast@1.0.0"         # projectile raycasting',
        '[dev-dependencies]',
        'Jest = "jsdotlua/jest@3.10.0"'
      ].join('\n')
    )
    expect(packages).toEqual([
      {
        name: 'ByteNet',
        spec: 'ffrostflame/bytenet@0.4.6',
        comment: 'client<->server networking',
        dev: false,
        optional: false
      },
      {
        name: 'FastCast',
        spec: 'megamonsta2/fastcast@1.0.0',
        comment: 'projectile raycasting',
        dev: false,
        optional: true
      },
      { name: 'Jest', spec: 'jsdotlua/jest@3.10.0', comment: null, dev: true, optional: false }
    ])
  })

  it('ignores section headers and prose comments', () => {
    expect(parseWallyToml('[dependencies]\n# just words here\n')).toEqual([])
  })
})
