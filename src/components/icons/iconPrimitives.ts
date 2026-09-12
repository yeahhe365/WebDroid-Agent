import type { SVGProps } from 'react'

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number | string
  strokeWidth?: number | string
  className?: string
  color?: string
  'aria-label'?: string
  'aria-hidden'?: boolean | 'true' | 'false'
}

export const defaultSize = 24
export const defaultStroke = 2
export const defaultColor = 'currentColor'
