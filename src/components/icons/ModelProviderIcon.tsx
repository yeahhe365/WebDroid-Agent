import type { FC } from 'react'
import { Bot } from 'lucide-react'
import { resolveProviderMeta } from './modelProviderMeta'

export interface ModelProviderIconProps {
  provider?: string | null
  model?: string | null
  baseUrl?: string | null
  size?: number
  className?: string
  alt?: string
}

export const ModelProviderIcon: FC<ModelProviderIconProps> = ({
  provider,
  model,
  baseUrl,
  size = 18,
  className = '',
  alt,
}) => {
  const meta = resolveProviderMeta(provider, model, baseUrl)

  if (!meta) {
    return <Bot size={size} className={className} aria-hidden="true" />
  }

  const classes = [
    'model-provider-icon',
    meta.invertInDark ? 'invert-dark' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <img
      src={meta.iconUrl}
      alt={alt ?? meta.label}
      width={size}
      height={size}
      className={classes}
      draggable={false}
      style={{ width: size, height: size, objectFit: 'contain' }}
      aria-hidden={alt ? undefined : 'true'}
    />
  )
}
