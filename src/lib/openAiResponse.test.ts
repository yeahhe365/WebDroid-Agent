import { describe, expect, it } from 'vitest'
import { extractAssistantText, normalizeTokenUsage } from './openAiResponse'

describe('extractAssistantText', () => {
  it('reads assistant content from a chat completion response', () => {
    expect(
      extractAssistantText({
        choices: [{ message: { content: '{"action":"done"}' } }],
      }),
    ).toBe('{"action":"done"}')
  })

  it('rejects empty completion responses', () => {
    expect(() => extractAssistantText({ choices: [] })).toThrow('No assistant content')
  })
})


describe('normalizeTokenUsage', () => {
  it('reads OpenAI chat usage', () => {
    expect(
      normalizeTokenUsage({ prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 }),
    ).toEqual({ inputTokens: 120, outputTokens: 30, totalTokens: 150 })
  })

  it('reads Responses and Gemini usage shapes', () => {
    expect(normalizeTokenUsage({ input_tokens: 10, output_tokens: 5 })).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    })
    expect(
      normalizeTokenUsage({ promptTokenCount: 7, candidatesTokenCount: 3, totalTokenCount: 10 }),
    ).toEqual({ inputTokens: 7, outputTokens: 3, totalTokens: 10 })
  })

  it('ignores missing and zero usage', () => {
    expect(normalizeTokenUsage(undefined)).toBeUndefined()
    expect(normalizeTokenUsage({ total_tokens: 0 })).toBeUndefined()
  })
})
