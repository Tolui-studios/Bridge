import { describe, expect, it } from 'vitest'
import { extractProjectName } from './rojoApi'

/** Build a msgpack fragment: fixstr "projectName" key followed by an encoded value. */
function msgpackWithName(value: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([0x89]), // fixmap, 9 entries — as Rojo 7.7 sends
    Buffer.from([0xa9]),
    Buffer.from('sessionId', 'utf8'),
    Buffer.from([0xa4]),
    Buffer.from('uuid', 'utf8'),
    Buffer.from([0xab]),
    Buffer.from('projectName', 'utf8'),
    value
  ])
}

function fixstr(s: string): Buffer {
  const bytes = Buffer.from(s, 'utf8')
  return Buffer.concat([Buffer.from([0xa0 + bytes.length]), bytes])
}

describe('extractProjectName', () => {
  it('reads a fixstr name from a msgpack body (Rojo 7.7)', () => {
    expect(extractProjectName(msgpackWithName(fixstr('SmokeTestGame')))).toBe('SmokeTestGame')
  })

  it('reads a str8 name (over 31 bytes)', () => {
    const long = 'A Very Long Project Name Exceeding Fixstr'
    const bytes = Buffer.from(long, 'utf8')
    const value = Buffer.concat([Buffer.from([0xd9, bytes.length]), bytes])
    expect(extractProjectName(msgpackWithName(value))).toBe(long)
  })

  it('reads a JSON body (older Rojo)', () => {
    const body = Buffer.from(JSON.stringify({ sessionId: 'x', projectName: 'MyGame' }), 'utf8')
    expect(extractProjectName(body)).toBe('MyGame')
  })

  it('returns undefined for a nil msgpack value', () => {
    expect(extractProjectName(msgpackWithName(Buffer.from([0xc0])))).toBeUndefined()
  })

  it('returns undefined when the key is missing (non-rojo HTTP server)', () => {
    expect(extractProjectName(Buffer.from('<html>hello</html>', 'utf8'))).toBeUndefined()
    expect(extractProjectName(Buffer.from(JSON.stringify({ ok: true }), 'utf8'))).toBeUndefined()
  })

  it('returns undefined for a truncated msgpack string', () => {
    const truncated = msgpackWithName(Buffer.from([0xad])) // fixstr len 13, no bytes follow
    expect(extractProjectName(truncated)).toBeUndefined()
  })
})
