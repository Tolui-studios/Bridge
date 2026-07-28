import { describe, expect, it } from 'vitest'
import {
  buildChoiceAnswers,
  parseAskUserQuestionInput,
  summarizeChoiceAnswers,
  summarizeChoiceQuestions
} from './agentChoices'

const validInput = {
  questions: [
    {
      question: 'Which data store should the leaderboard use?',
      header: 'Data store',
      multiSelect: false,
      options: [
        { label: 'ProfileStore', description: 'Session-locked, already in the stack' },
        { label: 'OrderedDataStore', description: 'Native ranking queries' }
      ]
    }
  ]
}

describe('parseAskUserQuestionInput', () => {
  it('parses a valid single question', () => {
    const parsed = parseAskUserQuestionInput(validInput)
    expect(parsed).not.toBeNull()
    expect(parsed![0].question).toBe('Which data store should the leaderboard use?')
    expect(parsed![0].header).toBe('Data store')
    expect(parsed![0].multiSelect).toBe(false)
    expect(parsed![0].options).toHaveLength(2)
    expect(parsed![0].options[1]).toEqual({
      label: 'OrderedDataStore',
      description: 'Native ranking queries'
    })
  })

  it('defaults header to empty, multiSelect to false, description to null', () => {
    const parsed = parseAskUserQuestionInput({
      questions: [
        {
          question: 'Pick one',
          options: [{ label: 'A' }, { label: 'B' }]
        }
      ]
    })
    expect(parsed).toEqual([
      {
        question: 'Pick one',
        header: '',
        multiSelect: false,
        options: [
          { label: 'A', description: null },
          { label: 'B', description: null }
        ]
      }
    ])
  })

  it('ignores unknown fields like preview without failing', () => {
    const parsed = parseAskUserQuestionInput({
      questions: [
        {
          question: 'Pick',
          options: [
            { label: 'A', preview: '<mockup>' },
            { label: 'B', preview: '<mockup>' }
          ],
          somethingNew: true
        }
      ]
    })
    expect(parsed).not.toBeNull()
    expect(parsed![0].options[0]).toEqual({ label: 'A', description: null })
  })

  it('rejects zero and five questions', () => {
    expect(parseAskUserQuestionInput({ questions: [] })).toBeNull()
    const q = validInput.questions[0]
    expect(parseAskUserQuestionInput({ questions: [q, q, q, q, q] })).toBeNull()
  })

  it('rejects one and five options', () => {
    expect(
      parseAskUserQuestionInput({
        questions: [{ question: 'Pick', options: [{ label: 'A' }] }]
      })
    ).toBeNull()
    const o = { label: 'X' }
    expect(
      parseAskUserQuestionInput({
        questions: [{ question: 'Pick', options: [o, o, o, o, o] }]
      })
    ).toBeNull()
  })

  it('rejects empty question text, empty labels, and non-object shapes', () => {
    expect(
      parseAskUserQuestionInput({
        questions: [{ question: '  ', options: [{ label: 'A' }, { label: 'B' }] }]
      })
    ).toBeNull()
    expect(
      parseAskUserQuestionInput({
        questions: [{ question: 'Pick', options: [{ label: '' }, { label: 'B' }] }]
      })
    ).toBeNull()
    expect(parseAskUserQuestionInput({ questions: 'nope' as unknown as [] })).toBeNull()
    expect(parseAskUserQuestionInput({})).toBeNull()
  })

  it('caps runaway text so the persisted summary stays bounded', () => {
    const parsed = parseAskUserQuestionInput({
      questions: [
        {
          question: 'q'.repeat(2000),
          options: [{ label: 'A' }, { label: 'B', description: 'd'.repeat(2000) }]
        }
      ]
    })
    expect(parsed![0].question.length).toBeLessThanOrEqual(501)
    expect(parsed![0].options[1].description!.length).toBeLessThanOrEqual(501)
  })
})

describe('buildChoiceAnswers', () => {
  const questions = parseAskUserQuestionInput(validInput)!

  it('keys answers by exact question text and echoes the RAW questions back', () => {
    const rawWithPreview = {
      questions: [
        {
          ...validInput.questions[0],
          options: validInput.questions[0].options.map((o) => ({ ...o, preview: '<p>' }))
        }
      ]
    }
    const parsed = parseAskUserQuestionInput(rawWithPreview)!
    const result = buildChoiceAnswers(rawWithPreview, parsed, {
      'Which data store should the leaderboard use?': 'ProfileStore'
    })
    expect('updatedInput' in result).toBe(true)
    if ('updatedInput' in result) {
      // Raw echo, not the normalized copy — preview must survive.
      expect(result.updatedInput.questions).toBe(rawWithPreview.questions)
      expect(result.updatedInput.answers).toEqual({
        'Which data store should the leaderboard use?': 'ProfileStore'
      })
    }
  })

  it('joins multi-select arrays with ", "', () => {
    const result = buildChoiceAnswers(validInput, questions, {
      'Which data store should the leaderboard use?': ['ProfileStore', 'OrderedDataStore']
    })
    if ('updatedInput' in result) {
      expect(result.updatedInput.answers).toEqual({
        'Which data store should the leaderboard use?': 'ProfileStore, OrderedDataStore'
      })
    } else {
      expect.fail(result.error)
    }
  })

  it('passes free-text ("Other…") answers through verbatim', () => {
    const result = buildChoiceAnswers(validInput, questions, {
      'Which data store should the leaderboard use?': 'Use MemoryStore, it resets weekly anyway'
    })
    if ('updatedInput' in result) {
      expect(result.updatedInput.answers).toEqual({
        'Which data store should the leaderboard use?': 'Use MemoryStore, it resets weekly anyway'
      })
    } else {
      expect.fail(result.error)
    }
  })

  it('errors when a question is unanswered or blank', () => {
    expect(buildChoiceAnswers(validInput, questions, {})).toEqual({
      error: 'Missing an answer for: Which data store should the leaderboard use?'
    })
    expect(
      buildChoiceAnswers(validInput, questions, {
        'Which data store should the leaderboard use?': '   '
      })
    ).toEqual({ error: 'Missing an answer for: Which data store should the leaderboard use?' })
    expect(
      buildChoiceAnswers(validInput, questions, {
        'Which data store should the leaderboard use?': []
      })
    ).toEqual({ error: 'Missing an answer for: Which data store should the leaderboard use?' })
  })
})

describe('transcript summaries', () => {
  const questions = parseAskUserQuestionInput(validInput)!

  it('lists options when asking', () => {
    expect(summarizeChoiceQuestions(questions)).toBe(
      'question: Which data store should the leaderboard use? [ProfileStore / OrderedDataStore]'
    )
  })

  it('renders the bare answer for a single question and pairs for several', () => {
    expect(
      summarizeChoiceAnswers(questions, {
        'Which data store should the leaderboard use?': 'ProfileStore'
      })
    ).toBe('ProfileStore')
    const two = [...questions, { ...questions[0], question: 'Second?' }]
    expect(
      summarizeChoiceAnswers(two, {
        'Which data store should the leaderboard use?': 'ProfileStore',
        'Second?': ['A', 'B']
      })
    ).toBe('Which data store should the leaderboard use? → ProfileStore\nSecond? → A, B')
  })
})
