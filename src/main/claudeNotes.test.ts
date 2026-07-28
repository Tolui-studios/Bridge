import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AGENT_NOTES_HEADING,
  MAX_NOTE_LENGTH,
  appendAgentNote,
  applyAgentNote
} from './claudeNotes'

const DOC = ['# Kingdom of Ash', '', '## Game rules', '', '- Server owns all currency', ''].join(
  '\n'
)

describe('appendAgentNote', () => {
  it('creates the section at the end when missing', () => {
    const result = appendAgentNote(DOC, 'ByteNet packets live in shared/Remotes')
    expect(result.changed).toBe(true)
    expect(result.content).toBe(
      [
        '# Kingdom of Ash',
        '',
        '## Game rules',
        '',
        '- Server owns all currency',
        '',
        AGENT_NOTES_HEADING,
        '',
        '- ByteNet packets live in shared/Remotes',
        ''
      ].join('\n')
    )
  })

  it('appends after the last bullet of an existing section', () => {
    const withSection = appendAgentNote(DOC, 'first note').content
    const result = appendAgentNote(withSection, 'second note')
    expect(result.changed).toBe(true)
    expect(result.content).toContain(
      [AGENT_NOTES_HEADING, '', '- first note', '- second note'].join('\n')
    )
  })

  it('keeps later sections intact when the notes section sits mid-document', () => {
    const doc = [
      '# Game',
      '',
      AGENT_NOTES_HEADING,
      '',
      '- existing note',
      '',
      '## Tree',
      '',
      'stuff',
      ''
    ].join('\n')
    const result = appendAgentNote(doc, 'new note')
    expect(result.content).toBe(
      [
        '# Game',
        '',
        AGENT_NOTES_HEADING,
        '',
        '- existing note',
        '- new note',
        '',
        '## Tree',
        '',
        'stuff',
        ''
      ].join('\n')
    )
  })

  it('starts from empty content', () => {
    const result = appendAgentNote('', 'lone note')
    expect(result.content).toBe([AGENT_NOTES_HEADING, '', '- lone note', ''].join('\n'))
  })

  it('skips exact duplicates', () => {
    const once = appendAgentNote(DOC, 'only once').content
    const twice = appendAgentNote(once, 'only once')
    expect(twice.changed).toBe(false)
    expect(twice.content).toBe(once)
  })

  it('collapses multi-line input and caps the length', () => {
    const result = appendAgentNote(DOC, `spread\nover\nlines ${'x'.repeat(400)}`)
    expect(result.note.startsWith('spread over lines')).toBe(true)
    expect(result.note.length).toBeLessThanOrEqual(MAX_NOTE_LENGTH)
    expect(result.content).toContain(`- ${result.note}\n`)
  })

  it('ignores empty notes', () => {
    const result = appendAgentNote(DOC, '   \n  ')
    expect(result.changed).toBe(false)
    expect(result.content).toBe(DOC)
  })

  it('normalizes CRLF input to LF output', () => {
    const result = appendAgentNote(DOC.replace(/\n/g, '\r\n'), 'crlf note')
    expect(result.content).not.toContain('\r')
    expect(result.content.endsWith('- crlf note\n')).toBe(true)
  })
})

describe('applyAgentNote', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-notes-'))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('creates CLAUDE.md when missing and reports duplicates on re-apply', () => {
    expect(applyAgentNote(dir, 'fresh note')).toBe("noted in CLAUDE.md: 'fresh note'")
    const file = path.join(dir, 'CLAUDE.md')
    expect(fs.readFileSync(file, 'utf8')).toContain('- fresh note')
    expect(applyAgentNote(dir, 'fresh note')).toBe("already noted: 'fresh note'")
    expect(applyAgentNote(dir, '  ')).toBe('note skipped (empty)')
  })
})
