import { describe, expect, it } from 'vitest'
import { buildPrMessage, titleFromTask } from './prMessage'

describe('titleFromTask', () => {
  it('takes the first non-empty line, whitespace-collapsed', () => {
    expect(titleFromTask('\n\n  Fix the   damage sync bug \ndetails below')).toBe(
      'Fix the damage sync bug'
    )
  })

  it('drops trailing punctuation', () => {
    expect(titleFromTask('Add a lobby door.')).toBe('Add a lobby door')
  })

  it('cuts long tasks at a word boundary with an ellipsis, within 72 chars', () => {
    const task =
      'make bridge auto pull the main repo quite often since no agents actually edit the main branch'
    const title = titleFromTask(task)!
    expect(title.length).toBeLessThanOrEqual(72)
    expect(title.endsWith('…')).toBe(true)
    expect(title).not.toMatch(/\S{40,}/) // no mid-word cut artifacts
    expect(title.slice(0, -1).endsWith(' ')).toBe(false)
  })

  it('is null for blank input', () => {
    expect(titleFromTask('')).toBeNull()
    expect(titleFromTask('   \n  ')).toBeNull()
    expect(titleFromTask(null)).toBeNull()
  })
})

describe('buildPrMessage', () => {
  it('titles from the task and includes task, commits, and test steps', () => {
    const message = buildPrMessage({
      branch: 'agent-tofu-1',
      task: 'Add a double-jump ability\nWith coyote time.',
      testSteps: ['Playtest and double-jump', 'Check the config value'],
      commits: ['feat: double jump', 'chore: agent-tofu-1 work in progress'],
      diffstat: '3 files changed, 40 insertions(+)'
    })
    expect(message.title).toBe('Add a double-jump ability')
    expect(message.body).toContain('## Task')
    expect(message.body).toContain('With coyote time.')
    expect(message.body).toContain('- feat: double jump')
    expect(message.body).toContain('- [ ] Playtest and double-jump')
    expect(message.body).toContain('3 files changed')
    expect(message.body).toContain('`agent-tofu-1`')
  })

  it('falls back to the first meaningful commit subject when there is no task', () => {
    const message = buildPrMessage({
      branch: 'agent-tofu-2',
      commits: ['chore: agent-tofu-2 work in progress', 'fix: nil guard in listen handler']
    })
    expect(message.title).toBe('fix: nil guard in listen handler')
  })

  it('never titles from WIP or merge commits; falls back to the branch', () => {
    const message = buildPrMessage({
      branch: 'agent-tofu-3',
      commits: ['chore: agent-tofu-3 work in progress', "Merge branch 'main' into agent-tofu-3"]
    })
    expect(message.title).toBe('Changes from agent-tofu-3')
  })

  it('caps the commit list and says how many were dropped', () => {
    const commits = Array.from({ length: 20 }, (_, i) => `feat: commit ${i}`)
    const message = buildPrMessage({ branch: 'b', commits })
    expect(message.body).toContain('- feat: commit 14')
    expect(message.body).not.toContain('- feat: commit 15')
    expect(message.body).toContain('…and 5 more')
  })

  it('omits empty sections but always keeps the footer', () => {
    const message = buildPrMessage({ branch: 'agent-tofu-4' })
    expect(message.body).not.toContain('## Task')
    expect(message.body).not.toContain('## Commits')
    expect(message.body).not.toContain('## How to test')
    expect(message.body).toContain('_Opened by Bridge from `agent-tofu-4`._')
  })
})
