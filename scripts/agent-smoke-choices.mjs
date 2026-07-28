// Verifies the AskUserQuestion round-trip Bridge relies on: the tool call
// reaches the canUseTool callback, an { behavior: 'allow', updatedInput }
// answer unblocks the turn, and the agent sees the picked option. Also prints
// whether AskUserQuestion is in the headless tool list, and whether a
// callback deny still emits system/permission_denied (Bridge dedupes either
// way — this just settles which reading is true).
// Run: node scripts/agent-smoke-choices.mjs   (uses Haiku to stay cheap)
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
input.push(
  user(
    'Use the AskUserQuestion tool to ask me ONE multiple-choice question: which color should the button be, options Red and Blue. After I answer, reply with exactly: CHOSE <answer>'
  )
)

let asked = false
const stream = query({
  prompt: input,
  options: {
    cwd: fileURLToPath(new URL('../fixtures/sample-game', import.meta.url)),
    permissionMode: 'default',
    allowedTools: [],
    model: 'claude-haiku-4-5-20251001',
    settingSources: ['user', 'project'],
    canUseTool: (toolName, toolInput) => {
      if (toolName !== 'AskUserQuestion') {
        console.log(`[canUseTool] DENY ${toolName}`)
        return Promise.resolve({ behavior: 'deny', message: 'not allowed in this smoke test' })
      }
      asked = true
      const questions = toolInput.questions ?? []
      console.log(`[canUseTool] AskUserQuestion: ${JSON.stringify(questions)}`)
      const answers = {}
      for (const q of questions) answers[q.question] = q.options?.[0]?.label ?? 'Red'
      console.log(`[canUseTool] answering with first option(s): ${JSON.stringify(answers)}`)
      return Promise.resolve({
        behavior: 'allow',
        updatedInput: { questions: toolInput.questions, answers }
      })
    },
    env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'bridge-smoke/0.1.0' }
  }
})

let finalText = ''
for await (const message of stream) {
  if (message.type === 'system' && message.subtype === 'init') {
    const hasAsk = message.tools.includes('AskUserQuestion')
    console.log(
      `[init] model=${message.model} tools=${message.tools.length} AskUserQuestion-in-tools=${hasAsk}`
    )
  } else if (message.type === 'system' && message.subtype === 'permission_denied') {
    console.log(`[permission_denied] ${message.tool_name} (${message.tool_use_id})`)
  } else if (message.type === 'assistant') {
    for (const block of message.message.content) {
      if (block.type === 'text' && block.text.trim()) {
        finalText = block.text.trim()
        console.log(`[text] ${finalText}`)
      } else if (block.type === 'tool_use') {
        console.log(`[tool_use] ${block.name}`)
      }
    }
  } else if (message.type === 'result') {
    console.log(
      `[result] ${message.subtype} turns=${message.num_turns} cost=$${message.total_cost_usd.toFixed(4)}`
    )
    input.end()
  }
}
const pass = asked && /CHOSE/i.test(finalText)
console.log(`[smoke] AskUserQuestion round-trip = ${pass ? 'PASS' : 'FAIL'}`)
