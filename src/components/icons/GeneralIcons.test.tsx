// @vitest-environment jsdom

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { IconNewChat, IconSidebarToggle, IconThinking, IconStop } from './GeneralIcons'

describe('GeneralIcons', () => {
  it('renders IconNewChat with SVG and paths', () => {
    const { container } = render(<IconNewChat size={20} strokeWidth={2} className="test-chat" />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('width')).toBe('20')
    expect(svg?.getAttribute('height')).toBe('20')
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(svg?.getAttribute('class')).toContain('test-chat')
    const paths = container.querySelectorAll('path')
    expect(paths.length).toBe(3)
  })

  it('renders IconSidebarToggle with 2 lines', () => {
    const { container } = render(<IconSidebarToggle size={18} strokeWidth={2} />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('width')).toBe('18')
    const lines = container.querySelectorAll('line')
    expect(lines.length).toBe(2)
    expect(lines[0]?.getAttribute('y1')).toBe('8')
    expect(lines[1]?.getAttribute('y1')).toBe('16')
  })

  it('renders IconThinking with 1024 viewBox', () => {
    const { container } = render(<IconThinking size={24} color="#f59e0b" />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('viewBox')).toBe('0 0 1024 1024')
    expect(svg?.getAttribute('fill')).toBe('#f59e0b')
  })

  it('renders IconStop as solid filled rounded rectangle', () => {
    const { container } = render(<IconStop size={14} color="currentColor" />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('fill')).toBe('currentColor')
    const rect = container.querySelector('rect')
    expect(rect).not.toBeNull()
    expect(rect?.getAttribute('x')).toBe('4')
    expect(rect?.getAttribute('y')).toBe('4')
    expect(rect?.getAttribute('width')).toBe('16')
    expect(rect?.getAttribute('height')).toBe('16')
  })
})
