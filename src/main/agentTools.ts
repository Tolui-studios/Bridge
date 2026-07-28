/**
 * Pure helpers for a session's tool allowlist. The allowlist is enforced as
 * SDK permission allow-rules in the flag-settings layer (`settings` at launch,
 * `applyFlagSettings` for runtime changes) rather than the `allowedTools`
 * query option — the option is launch-frozen, while flag settings can be
 * replaced wholesale mid-session, which is what makes runtime tool changes
 * possible without restarting the session.
 */

/**
 * Tools that must never become allow-rules. AskUserQuestion has to reach the
 * canUseTool callback so the operator can answer in the UI — an allow rule
 * bypasses the callback and the tool would run with no answers.
 */
const NEVER_ALLOWED = new Set(['AskUserQuestion'])

/** Trim, dedupe, and strip banned entries from an operator-supplied tool list. */
export function sanitizeToolList(tools: readonly string[]): string[] {
  const out: string[] = []
  for (const raw of tools) {
    const tool = raw.trim()
    if (!tool || NEVER_ALLOWED.has(tool) || out.includes(tool)) continue
    out.push(tool)
  }
  return out
}

/**
 * Permission allow-rules for a tool list. An MCP glob (`mcp__server__*`) also
 * emits the bare-server form (`mcp__server`): settings-style rules document
 * the bare name as "all tools from this server", while the old `allowedTools`
 * option wanted the trailing `*` — emitting both keeps every CLI version
 * covered, and whichever form a version doesn't recognize is inert.
 */
export function toAllowRules(tools: readonly string[]): string[] {
  const rules: string[] = []
  for (const tool of sanitizeToolList(tools)) {
    if (!rules.includes(tool)) rules.push(tool)
    const glob = /^(mcp__.+)__\*$/.exec(tool)
    if (glob && !rules.includes(glob[1])) rules.push(glob[1])
  }
  return rules
}
