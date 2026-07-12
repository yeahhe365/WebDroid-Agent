import { describe, expect, it, vi } from 'vitest'
import {
  convertChatPayloadToResponses,
  createOpenAiResponsesClient,
  extractResponsesText,
  mapToOpenAiOfficialEffort,
} from './openAiResponsesClient'
import type { ChatCompletionPayload } from './openAiTypes'

describe('mapToOpenAiOfficialEffort', () => {
  it('maps minimal to low for GPT-5.6 Responses API', () => {
    expect(mapToOpenAiOfficialEffort('minimal')).toBe('low')
  })

  it('passes through GPT-5.6 effort values', () => {
    expect(mapToOpenAiOfficialEffort('max')).toBe('max')
    expect(mapToOpenAiOfficialEffort('xhigh')).toBe('xhigh')
    expect(mapToOpenAiOfficialEffort('none')).toBe('none')
  })
})

describe('convertChatPayloadToResponses', () => {
  it('maps system messages to instructions and user multimodal content to Responses parts', () => {
    const payload: ChatCompletionPayload = {
      model: 'gpt-5.6',
      temperature: 0.1,
      max_tokens: 800,
      response_format: { type: 'json_object' },
      reasoning_effort: 'high',
      messages: [
        { role: 'system', content: 'You are an agent.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Open settings' },
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,abc123' },
            },
          ],
        },
      ],
    }

    const responses = convertChatPayloadToResponses(payload, {
      reasoningMode: 'pro',
      reasoningSummary: 'auto',
    })

    expect(responses).toEqual({
      model: 'gpt-5.6',
      instructions: 'You are an agent.',
      temperature: 0.1,
      max_output_tokens: 800,
      text: { format: { type: 'json_object' } },
      reasoning: {
        effort: 'high',
        mode: 'pro',
        summary: 'auto',
      },
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'Open settings' },
            {
              type: 'input_image',
              image_url: 'data:image/png;base64,abc123',
              detail: 'auto',
            },
          ],
        },
      ],
    })
  })

  it('omits standard reasoning mode and only sends pro when selected', () => {
    const payload: ChatCompletionPayload = {
      model: 'gpt-5.6',
      temperature: 0,
      max_tokens: 10,
      reasoning_effort: 'medium',
      messages: [{ role: 'user', content: 'hi' }],
    }

    expect(convertChatPayloadToResponses(payload, { reasoningMode: 'standard' }).reasoning).toEqual({
      effort: 'medium',
    })
    expect(convertChatPayloadToResponses(payload, { reasoningMode: 'pro' }).reasoning).toEqual({
      effort: 'medium',
      mode: 'pro',
    })
  })
})

describe('extractResponsesText', () => {
  it('prefers output_text and falls back to message output parts', () => {
    expect(
      extractResponsesText({
        output_text: '  from field  ',
        output: [],
      }),
    ).toBe('from field')

    expect(
      extractResponsesText({
        output: [
          { type: 'reasoning', summary: [{ type: 'summary_text', text: 'thinking' }] },
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '{"action":"tap"}' }],
          },
        ],
      }),
    ).toBe('{"action":"tap"}')
  })
})

describe('createOpenAiResponsesClient', () => {
  it('posts to the Responses API with nested reasoning parameters', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        output_text: '{"action":"tap","x":10,"y":20}',
      }),
    )
    const client = createOpenAiResponsesClient(fetcher)

    const text = await client.completeAction({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-5.6',
      provider: 'openai',
      reasoningEffort: 'max',
      openaiReasoningMode: 'pro',
      openaiReasoningSummary: 'concise',
      task: 'Open settings',
      screenshotDataUrl: 'data:image/png;base64,abc',
      screen: { width: 1080, height: 2400 },
    })

    expect(text).toBe('{"action":"tap","x":10,"y":20}')
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/responses')
    expect(init?.method).toBe('POST')
    const body = JSON.parse(String(init?.body))
    expect(body.model).toBe('gpt-5.6')
    expect(body.reasoning).toEqual({
      effort: 'max',
      mode: 'pro',
      summary: 'concise',
    })
    expect(body.text).toEqual({ format: { type: 'json_object' } })
    expect(body.max_output_tokens).toBe(800)
  })

  it('forwards Responses path through the local proxy envelope', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'done' }],
          },
        ],
      }),
    )
    const client = createOpenAiResponsesClient(fetcher, {
      proxyUrl: '/api/openai/chat/completions',
    })

    await client.completeFinalResponse?.({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-5.6',
      provider: 'openai',
      reasoningEffort: 'low',
      task: 'Summarize',
    })

    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('/api/openai/chat/completions')
    const body = JSON.parse(String(init?.body))
    expect(body.path).toBe('/responses')
    expect(body.payload.reasoning).toEqual({ effort: 'low' })
    expect(body.payload.response_format).toBeUndefined()
  })
})
