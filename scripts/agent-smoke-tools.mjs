// Verifies the runtime tool-allowlist mechanism Bridge uses: allow rules live
// in the SDK's DYNAMIC flag-settings layer — applyFlagSettings right after
// query() for the launch set (before the first prompt is pushed), and again
// for every change — and each call REPLACES the layer, so removing a tool
// takes real effect, not just adding one. The rules must NOT ride the inline
// `settings` option instead: its rules persist beneath the dynamic layer and
// a runtime removal can never win (measured — that regression is exactly what
// this smoke guards). Mode dontAsk makes allow rules the only thing that can
// approve a tool, which is what we need to observe. settingSources is
// deliberately omitted so machine-level allow rules can't mask the layer
// under test.
// Run: node scripts/agent-smoke-tools.mjs   (uses Haiku to stay cheap)
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

// The probe must be a WRITE command: recent CLIs auto-approve safe read-only
// Bash (echo, ls, …) with no allow rule at all, which fakes a PASS.
const ASK =
  'Use the Bash tool to run exactly: mkdir -p /tmp/bridge-tools-smoke. If the tool call is denied or errors, reply with exactly the single word DENIED. If it runs, reply with exactly the single word RAN.'

const input = new PushQueue()

const stream = query({
  prompt: input,
  options: {
    cwd: fileURLToPath(new URL('../fixtures/sample-game', import.meta.url)),
    permissionMode: 'dontAsk',
    model: 'claude-haiku-4-5-20251001',
    env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'bridge-smoke/0.1.0' }
  }
})

// Exactly the production order: rules land before the first prompt exists.
await stream.applyFlagSettings({ permissions: { allow: ['Bash'] } })
input.push(user(ASK))

const phases = [
  { label: 'launch rules (applyFlagSettings before turn 1) allow Bash', expect: 'RAN' },
  { label: 'applyFlagSettings removed Bash', expect: 'DENIED' },
  { label: 'applyFlagSettings re-added Bash', expect: 'RAN' }
]
let phase = 0
let lastText = ''
const verdicts = []
for await (const message of stream) {
  if (message.type === 'system' && message.subtype === 'init') {
    console.log(`[init] model=${message.model} session=${message.session_id.slice(0, 8)}…`)
  } else if (message.type === 'assistant') {
    for (const block of message.message.content) {
      if (block.type === 'text' && block.text.trim()) lastText = block.text.trim()
    }
  } else if (message.type === 'result') {
    const upper = lastText.toUpperCase()
    const got = upper.includes('DENIED') ? 'DENIED' : upper.includes('RAN') ? 'RAN' : `?(${lastText.slice(0, 60)})`
    const want = phases[phase].expect
    verdicts.push(got === want)
    console.log(
      `[phase ${phase + 1}] ${phases[phase].label}: expected ${want}, got ${got} → ${got === want ? 'PASS' : 'FAIL'} (cost $${message.total_cost_usd.toFixed(4)})`
    )
    phase++
    lastText = ''
    if (phase === 1) {
      await stream.applyFlagSettings({ permissions: { allow: [] } })
      input.push(user(ASK))
    } else if (phase === 2) {
      await stream.applyFlagSettings({ permissions: { allow: ['Bash'] } })
      input.push(user(ASK))
    } else {
      input.end()
    }
  }
}
const pass = verdicts.length === phases.length && verdicts.every(Boolean)
console.log(`[smoke] ${verdicts.filter(Boolean).length}/${phases.length} phases = ${pass ? 'PASS' : 'FAIL'}`)
process.exitCode = pass ? 0 : 1
