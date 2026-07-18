/** Strip Electron's IPC wrapper prefix from errors thrown by main-process handlers. */
export function cleanIpcError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.replace(/^Error invoking remote method '[^']+': /, '').replace(/^Error: /, '')
}
