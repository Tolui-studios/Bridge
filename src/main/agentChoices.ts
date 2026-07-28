import type { PendingChoiceQuestion } from '@shared/types'

/**
 * Pure logic for the AskUserQuestion round-trip: validating the tool input
 * into the shape the renderer draws, and shaping the operator's answers into
 * the `updatedInput` the SDK expects back. Electron-free for unit testing
 * (AgentService itself imports electron at module level).
 */

/** Bounds from the tool's contract; input outside them is treated as malformed. */
const MAX_QUESTIONS = 4
const MIN_OPTIONS = 2
const MAX_OPTIONS = 4
/** Keeps the persisted summary bounded even if the model sends walls of text. */
const MAX_TEXT = 500

function capText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text
}

/**
 * Validate/normalize an AskUserQuestion tool input. Returns null when the
 * input is malformed (the caller denies the call and the agent re-asks).
 * Unknown fields (e.g. `preview`) are ignored, never a reason to fail.
 */
export function parseAskUserQuestionInput(
  input: Record<string, unknown>
): PendingChoiceQuestion[] | null {
  const rawQuestions = input.questions
  if (!Array.isArray(rawQuestions)) return null
  if (rawQuestions.length < 1 || rawQuestions.length > MAX_QUESTIONS) return null

  const questions: PendingChoiceQuestion[] = []
  for (const raw of rawQuestions) {
    if (typeof raw !== 'object' || raw === null) return null
    const q = raw as Record<string, unknown>
    const question = capText(q.question)
    if (!question) return null
    if (!Array.isArray(q.options)) return null
    if (q.options.length < MIN_OPTIONS || q.options.length > MAX_OPTIONS) return null
    const options: PendingChoiceQuestion['options'] = []
    for (const rawOption of q.options) {
      if (typeof rawOption !== 'object' || rawOption === null) return null
      const o = rawOption as Record<string, unknown>
      const label = capText(o.label)
      if (!label) return null
      options.push({ label, description: capText(o.description) })
    }
    questions.push({
      question,
      header: capText(q.header) ?? '',
      multiSelect: q.multiSelect === true,
      options
    })
  }
  return questions
}

/**
 * Shape the operator's answers into the tool's `updatedInput`. Every parsed
 * question must be answered, keyed by its exact text. The raw `questions`
 * from the original input are echoed back verbatim (not the normalized copy)
 * so fields the parser doesn't model — `preview` and future additions —
 * survive the round-trip. Free-text ("Other…") answers pass through as-is;
 * multi-select arrays join with ', ' per the tool contract.
 */
export function buildChoiceAnswers(
  rawInput: Record<string, unknown>,
  questions: PendingChoiceQuestion[],
  answers: Record<string, string | string[]>
): { updatedInput: Record<string, unknown> } | { error: string } {
  const shaped: Record<string, string> = {}
  for (const q of questions) {
    const raw = answers[q.question]
    const value = Array.isArray(raw) ? raw.filter((v) => v.trim()).join(', ') : (raw ?? '').trim()
    if (!value) return { error: `Missing an answer for: ${q.question}` }
    shaped[q.question] = value
  }
  return { updatedInput: { questions: rawInput.questions, answers: shaped } }
}

/** One-line transcript rendering of the questions being asked. */
export function summarizeChoiceQuestions(questions: PendingChoiceQuestion[]): string {
  return questions
    .map((q) => `question: ${q.question} [${q.options.map((o) => o.label).join(' / ')}]`)
    .join('\n')
}

/** One-line transcript rendering of what the operator picked. */
export function summarizeChoiceAnswers(
  questions: PendingChoiceQuestion[],
  answers: Record<string, string | string[]>
): string {
  return questions
    .map((q) => {
      const raw = answers[q.question]
      const value = Array.isArray(raw) ? raw.join(', ') : (raw ?? '')
      return questions.length > 1 ? `${q.question} → ${value}` : value
    })
    .join('\n')
}
