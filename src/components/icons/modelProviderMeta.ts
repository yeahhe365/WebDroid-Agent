import openaiIconUrl from '../../assets/model-icons/openai.svg'
import dashscopeIconUrl from '../../assets/model-icons/dashscope.svg'
import geminiIconUrl from '../../assets/model-icons/gemini.svg'
import zhipuIconUrl from '../../assets/model-icons/zhipu.svg'
import deepseekIconUrl from '../../assets/model-icons/deepseek.svg'
import ollamaIconUrl from '../../assets/model-icons/ollama.svg'
import anthropicIconUrl from '../../assets/model-icons/anthropic.svg'

export type ProviderMeta = {
  iconUrl: string
  label: string
  invertInDark?: boolean
}

export const KNOWN_PROVIDERS: Record<string, ProviderMeta> = {
  openai: { iconUrl: openaiIconUrl, label: 'OpenAI', invertInDark: true },
  qwen: { iconUrl: dashscopeIconUrl, label: 'Qwen / DashScope' },
  dashscope: { iconUrl: dashscopeIconUrl, label: 'DashScope' },
  gemini: { iconUrl: geminiIconUrl, label: 'Gemini' },
  zhipu: { iconUrl: zhipuIconUrl, label: 'Zhipu / GLM' },
  glm: { iconUrl: zhipuIconUrl, label: 'Zhipu / GLM' },
  autoglm: { iconUrl: zhipuIconUrl, label: 'AutoGLM' },
  deepseek: { iconUrl: deepseekIconUrl, label: 'DeepSeek' },
  ollama: { iconUrl: ollamaIconUrl, label: 'Ollama', invertInDark: true },
  anthropic: { iconUrl: anthropicIconUrl, label: 'Anthropic', invertInDark: true },
}

export function resolveProviderMeta(
  provider?: string | null,
  model?: string | null,
  baseUrl?: string | null,
): ProviderMeta | null {
  const normProvider = provider?.trim().toLowerCase()
  if (normProvider && normProvider !== 'custom' && KNOWN_PROVIDERS[normProvider]) {
    return KNOWN_PROVIDERS[normProvider]
  }

  const combined = `${model ?? ''} ${baseUrl ?? ''}`.toLowerCase()
  if (combined.includes('glm') || combined.includes('zhipu') || combined.includes('autoglm')) {
    return KNOWN_PROVIDERS.zhipu
  }
  if (
    combined.includes('qwen') ||
    combined.includes('dashscope') ||
    combined.includes('bailian') ||
    combined.includes('aliyun')
  ) {
    return KNOWN_PROVIDERS.qwen
  }
  if (
    combined.includes('gemini') ||
    combined.includes('googleapis') ||
    combined.includes('generativelanguage')
  ) {
    return KNOWN_PROVIDERS.gemini
  }
  if (combined.includes('deepseek')) {
    return KNOWN_PROVIDERS.deepseek
  }
  if (combined.includes('openai') || combined.includes('gpt') || /\bo[1-4]\b/.test(combined)) {
    return KNOWN_PROVIDERS.openai
  }
  if (combined.includes('claude') || combined.includes('anthropic')) {
    return KNOWN_PROVIDERS.anthropic
  }
  if (combined.includes('ollama') || combined.includes('11434')) {
    return KNOWN_PROVIDERS.ollama
  }

  return null
}
