import { describe, expect, it } from 'vitest'
import { sanitizeToolList, toAllowRules } from './agentTools'

describe('sanitizeToolList', () => {
  it('passes plain tool names through in order', () => {
    expect(sanitizeToolList(['Read', 'Edit', 'Bash'])).toEqual(['Read', 'Edit', 'Bash'])
  })

  it('trims whitespace and drops empty entries', () => {
    expect(sanitizeToolList([' Read ', '', '  ', 'Bash'])).toEqual(['Read', 'Bash'])
  })

  it('dedupes repeated entries', () => {
    expect(sanitizeToolList(['Read', 'Read', ' Read'])).toEqual(['Read'])
  })

  it('always strips AskUserQuestion — it must reach canUseTool, never an allow rule', () => {
    expect(sanitizeToolList(['Read', 'AskUserQuestion', 'Bash'])).toEqual(['Read', 'Bash'])
  })

  it('returns [] for an empty list', () => {
    expect(sanitizeToolList([])).toEqual([])
  })
})

describe('toAllowRules', () => {
  it('maps plain tool names to identical rules', () => {
    expect(toAllowRules(['Read', 'Bash'])).toEqual(['Read', 'Bash'])
  })

  it('expands an MCP glob to include the bare-server rule form', () => {
    expect(toAllowRules(['mcp__robloxstudio__*'])).toEqual([
      'mcp__robloxstudio__*',
      'mcp__robloxstudio'
    ])
  })

  it('does not duplicate the bare form when it is already listed', () => {
    expect(toAllowRules(['mcp__robloxstudio', 'mcp__robloxstudio__*'])).toEqual([
      'mcp__robloxstudio',
      'mcp__robloxstudio__*'
    ])
  })

  it('leaves a specific MCP tool name alone', () => {
    expect(toAllowRules(['mcp__robloxstudio__create_object'])).toEqual([
      'mcp__robloxstudio__create_object'
    ])
  })

  it('sanitizes on the way through', () => {
    expect(toAllowRules([' Bash ', 'AskUserQuestion', 'Bash'])).toEqual(['Bash'])
  })
})
