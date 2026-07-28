/**
 * The Roblox Studio MCP server — how game agents do instance/asset work in a
 * live Studio session (see docs/GLOBAL-CLAUDE.md, "3D models & Studio-side
 * work"). Bridge passes this to the Agent SDK programmatically rather than
 * relying on a per-machine `claude mcp add`, so a fresh dev machine needs no
 * setup step beyond having Studio open.
 *
 * On by default in the launch form: Studio work is the norm for these games.
 * It can still be switched off per launch — the server is only spawned when
 * the tool whitelist asks for it, so an opted-out run costs nothing.
 */
export const ROBLOX_MCP_SERVER = 'robloxstudio'

export const ROBLOX_MCP_NAME = '@chrrxs/robloxstudio-mcp'

/**
 * Pinned deliberately. `@latest` forced npx to re-resolve the dist-tag against
 * the npm registry on EVERY agent launch (~1.3–2s measured, even warm). An
 * exact version resolves from the local cache — and the managed install
 * (mcpInstall.ts) skips npx on the launch path entirely. To bump: check
 * `npm view @chrrxs/robloxstudio-mcp version`, update here, done — the
 * managed install re-installs itself when the pin changes.
 */
export const ROBLOX_MCP_VERSION = '2.22.5'

export const ROBLOX_MCP_PACKAGE = `${ROBLOX_MCP_NAME}@${ROBLOX_MCP_VERSION}`

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
