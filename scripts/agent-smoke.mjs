// Minimal end-to-end check of the Agent SDK pipeline Bridge uses:
// spawn, auth, stream, result — one turn, no tools, in the fixture game.
// Run: node scripts/agent-smoke.mjs
import { query } from '@anthropic-ai/claude-agent-sdk'
import { fileURLToPath } from 'node:url'

const cwd = fileURLToPath(new URL('../fixtures/sample-game', import.meta.url))

const stream = query({
  prompt: 'Reply with exactly the single word: PONG',
  options: {
    cwd,
    permissionMode: 'dontAsk',
    allowedTools: [],
    maxTurns: 1,
    stderr: (data) => process.stderr.write(`[stderr] ${data}`),
    env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'bridge-smoke/0.1.0' }
  }
})

for await (const message of stream) {
  if (message.type === 'system' && message.subtype === 'init') {
    console.log(
      `[init] model=${message.model} claude-code=${message.claude_code_version} tools=${message.tools.length} mode=${message.permissionMode}`
    )
  } else if (message.type === 'assistant') {
    for (const block of message.message.content) {
      if (block.type === 'text') console.log(`[text] ${block.text}`)
    }
  } else if (message.type === 'result') {
    console.log(
      `[result] ${message.subtype} turns=${message.num_turns} cost=$${message.total_cost_usd.toFixed(4)} is_error=${message.is_error}`
    )
  }
}

console.log('[smoke] stream complete')
