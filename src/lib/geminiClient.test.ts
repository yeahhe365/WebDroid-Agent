import { describe, expect, it, vi } from 'vitest'
import { convertChatPayloadToGemini, createGeminiClient } from './geminiClient'
import type { ChatCompletionPayload } from './openAiTypes'

describe('convertChatPayloadToGemini', () => {
  it('maps system message to systemInstruction and the rest to contents', () => {
    const payload: ChatCompletionPayload = {
      model: 'gemini-3.5-flash',
      temperature: 0.1,
      max_tokens: 800,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are an agent.' },
        { role: 'user', content: 'Open settings' },
      ],
    }

    const gemini = convertChatPayloadToGemini(payload)

    expect(gemini.systemInstruction).toEqual({ parts: [{ text: 'You are an agent.' }] })
    expect(gemini.contents).toEqual([
      { role: 'user', parts: [{ text: 'Open settings' }] },
    ])
    expect(gemini.generationConfig).toMatchObject({
      temperature: 0.1,
      maxOutputTokens: 800,
      responseMimeType: 'application/json',
    })
  })

  it('converts multimodal image_url parts to inline_data', () => {
    const payload: ChatCompletionPayload = {
      model: 'gemini-3.5-flash',
      temperature: 0,
      max_tokens: 10,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this screen' },
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,abc123' },
            },
          ],
        },
      ],
    }

    const gemini = convertChatPayloadToGemini(payload)

    expect(gemini.contents[0].parts).toEqual([
      { text: 'Describe this screen' },
      { inline_data: { mime_type: 'image/png', data: 'abc123' } },
    ])
  })

  it('maps reasoning_effort to thinkingLevel', () => {
    const payload: ChatCompletionPayload = {
      model: 'gemini-3.5-flash',
      temperature: 0,
      max_tokens: 10,
      reasoning_effort: 'high',
      messages: [{ role: 'user', content: 'hi' }],
    }

    const gemini = convertChatPayloadToGemini(payload)

    expect(gemini.generationConfig?.thinkingConfig).toEqual({ thinkingLevel: 'high' })
  })
})

describe('createGeminiClient', () => {
  it('reports usage from streamed generateContent chunks', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n',
              'data: {"candidates":[],"usageMetadata":{"promptTokenCount":4,"candidatesTokenCount":2,"totalTokenCount":6}}\n\n',
            ].join(''),
          ),
        )
        controller.close()
      },
    })
    const fetcher = vi.fn<typeof fetch>(async () => new Response(stream))
    const client = createGeminiClient(fetcher)
    const onUsage = vi.fn()

    const text = await client.completeAction({
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'key',
      model: 'gemini-3.5-flash',
      stream: true,
      task: 'Say ok',
      screenshotDataUrl: 'data:image/png;base64,abc',
      screen: { width: 10, height: 20 },
      onUsage,
    })

    expect(text).toBe('ok')
    expect(onUsage).toHaveBeenCalledWith({
      inputTokens: 4,
      outputTokens: 2,
      totalTokens: 6,
    })
  })
})
