// @vitest-environment jsdom

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ModelProviderIcon } from './ModelProviderIcon'
import { resolveProviderMeta } from './modelProviderMeta'

describe('resolveProviderMeta', () => {
  it('resolves explicit known providers', () => {
    expect(resolveProviderMeta('openai')?.label).toBe('OpenAI')
    expect(resolveProviderMeta('qwen')?.label).toContain('Qwen')
    expect(resolveProviderMeta('gemini')?.label).toBe('Gemini')
    expect(resolveProviderMeta('zhipu')?.label).toContain('Zhipu')
    expect(resolveProviderMeta('deepseek')?.label).toBe('DeepSeek')
  })

  it('infers provider from model or baseUrl when provider is custom or empty', () => {
    expect(resolveProviderMeta('custom', 'gpt-4o', 'https://api.openai.com/v1')?.label).toBe('OpenAI')
    expect(resolveProviderMeta(null, 'qwen-max', 'https://dashscope.aliyuncs.com')?.label).toContain('Qwen')
    expect(resolveProviderMeta(null, 'autoglm-phone', '')?.label).toContain('Zhipu')
    expect(resolveProviderMeta('custom', 'deepseek-v3', '')?.label).toBe('DeepSeek')
    expect(resolveProviderMeta('custom', 'gemini-2.5-flash', '')?.label).toBe('Gemini')
  })

  it('returns null for completely unrecognized provider/model', () => {
    expect(resolveProviderMeta('custom', 'my-unknown-model', 'https://example.com')).toBeNull()
  })
})

describe('ModelProviderIcon', () => {
  it('renders img with brand logo and invert-dark for openai', () => {
    const { container } = render(<ModelProviderIcon provider="openai" size={18} />)
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBeTruthy()
    expect(img?.getAttribute('alt')).toBe('OpenAI')
    expect(img?.getAttribute('class')).toContain('invert-dark')
    expect(img?.getAttribute('width')).toBe('18')
  })

  it('renders img without invert-dark for colorful logos (qwen, gemini, zhipu)', () => {
    const { container: qwenContainer } = render(<ModelProviderIcon provider="qwen" />)
    expect(qwenContainer.querySelector('img')?.getAttribute('class')).not.toContain('invert-dark')

    const { container: geminiContainer } = render(<ModelProviderIcon provider="gemini" />)
    expect(geminiContainer.querySelector('img')?.getAttribute('class')).not.toContain('invert-dark')

    const { container: zhipuContainer } = render(<ModelProviderIcon provider="zhipu" />)
    expect(zhipuContainer.querySelector('img')?.getAttribute('class')).not.toContain('invert-dark')
  })

  it('falls back to Bot icon for unknown provider/model', () => {
    const { container } = render(<ModelProviderIcon provider="custom" model="custom-unknown" />)
    expect(container.querySelector('img')).toBeNull()
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
  })
})
