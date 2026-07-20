/**
 * The Roblox Studio MCP server — how game agents do instance/asset work in a
 * live Studio session (see docs/GLOBAL-CLAUDE.md, "3D models & Studio-side
 * work"). Bridge passes this to the Agent SDK programmatically rather than
 * relying on a per-machine `claude mcp add`, so a fresh dev machine needs no
 * setup step beyond having Studio open.
 *
 * The server is opt-in per launch: it spawns an npx process and is useless
 * unless Roblox Studio is actually running, so it is not in the default
 * toolset.
 */
export const ROBLOX_MCP_SERVER = 'robloxstudio'

export const ROBLOX_MCP_PACKAGE = '@chrrxs/robloxstudio-mcp@latest'

/**
 * Wildcard entry for the agent's `allowedTools` whitelist. The SDK names MCP
 * tools `mcp__<server>__<tool>`; the trailing `*` allows all of them. A bare
 * server name is NOT a valid allowedTools wildcard — only a disallowedTools one.
 */
export const ROBLOX_MCP_TOOL_GLOB = `mcp__${ROBLOX_MCP_SERVER}__*`

/** Does this launch's tool whitelist ask for the Studio MCP? */
export function wantsRobloxMcp(allowedTools: readonly string[]): boolean {
  return allowedTools.some((tool) => tool.startsWith(`mcp__${ROBLOX_MCP_SERVER}__`))
}
