// Verifies the interactive session model Bridge uses: streaming prompt input
// keeps the Claude Code process alive after a result, a follow-up prompt runs
// in the SAME session, and ending the input closes it cleanly.
// Run: node scripts/agent-smoke-interactive.mjs   (uses Haiku to stay cheap)
import { query } from '@anthropic-ai/claude-agent-sdk'
import { fileURLToPath } from 'node:url'

class PushQueue {
  values = []
  resolvers = []
  ended = false
  push(value) {
    const resolve = this.resolvers.shift()
    if (resolve) resolve({ value, done: false })
    else this.values.push(value)
  }
  end() {
    this.ended = true
    for (const resolve of this.resolvers.splice(0)) resolve({ value: undefined, done: true })
  }
  [Symbol.asyncIterator]() {
    return {
      next: () => {
        const value = this.values.shift()
        if (value !== undefined) return Promise.resolve({ value, done: false })
        if (this.ended) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => this.resolvers.push(resolve))
      }
    }
  }
}

const user = (text) => ({
  type: 'user',
  message: { role: 'user', content: text },
  parent_tool_use_id: null
})

const input = new PushQueue()
input.push(user('Reply with exactly the single word: PING'))

const stream = query({
  prompt: input,
  options: {
    cwd: fileURLToPath(new URL('../fixtures/sample-game', import.meta.url)),
    permissionMode: 'dontAsk',
    allowedTools: [],
    model: 'claude-haiku-4-5-20251001',
    settingSources: ['user', 'project'],
    env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'bridge-smoke/0.1.0' }
  }
})

let results = 0
let sessionId = null
for await (const message of stream) {
  if (message.type === 'system' && message.subtype === 'init') {
    sessionId = message.session_id
    console.log(`[init] model=${message.model} session=${sessionId.slice(0, 8)}…`)
  } else if (message.type === 'assistant') {
    for (const block of message.message.content) {
      if (block.type === 'text') console.log(`[text] ${block.text}`)
    }
  } else if (message.type === 'result') {
    results++
    console.log(
      `[result #${results}] ${message.subtype} turns=${message.num_turns} cost=$${message.total_cost_usd.toFixed(4)} session=${message.session_id.slice(0, 8)}…`
    )
    if (results === 1) {
      console.log('[smoke] session idle — sending follow-up into the same session')
      input.push(user('Now reply with exactly the single word: PONG'))
    } else {
      input.end()
    }
  }
}
console.log(`[smoke] complete: ${results} results, one session = ${results === 2 ? 'PASS' : 'FAIL'}`)
