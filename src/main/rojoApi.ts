import net from 'node:net'

/**
 * Talking to a `rojo serve` HTTP API — electron-free and vitest-covered.
 * All probes use 127.0.0.1 explicitly: `localhost` can resolve to ::1, and
 * rojo binds the IPv4 loopback.
 */

const PROBE_TIMEOUT_MS = 750

/**
 * Extract `projectName` from an /api/rojo response body. Rojo 7.7+ answers in
 * MessagePack (regardless of Accept header); older versions answer in JSON.
 * Rather than pull in a msgpack dependency for one field, scan for the key and
 * decode the string value that follows it (fixstr/str8/str16 cover any sane
 * project name; anything else — e.g. nil — reads as absent).
 */
export function extractProjectName(body: Buffer): string | undefined {
  try {
    const parsed = JSON.parse(body.toString('utf8')) as { projectName?: unknown }
    return typeof parsed.projectName === 'string' ? parsed.projectName : undefined
  } catch {
    // Not JSON — msgpack.
  }
  const key = Buffer.from('projectName', 'utf8')
  const at = body.indexOf(key)
  if (at < 0) return undefined
  let i = at + key.length
  const type = body[i]
  let length = 0
  if (type >= 0xa0 && type <= 0xbf) {
    length = type - 0xa0
    i += 1
  } else if (type === 0xd9) {
    length = body[i + 1]
    i += 2
  } else if (type === 0xda) {
    length = body.readUInt16BE(i + 1)
    i += 3
  } else {
    return undefined
  }
  if (length === 0 || i + length > body.length) return undefined
  return body.subarray(i, i + length).toString('utf8')
}

/**
 * GET /api/rojo. Returns `{ projectName }` if a server answered HTTP there
 * (projectName undefined when it isn't a recognizable rojo server), or null
 * if nothing answered at all.
 */
export async function probeRojoApi(port: number): Promise<{ projectName?: string } | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/rojo`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    })
    if (!res.ok) return {}
    return { projectName: extractProjectName(Buffer.from(await res.arrayBuffer())) }
  } catch {
    return null
  }
}

export function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)))
  })
}
