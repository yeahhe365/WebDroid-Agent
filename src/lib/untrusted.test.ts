import { describe, expect, it } from 'vitest'
import {
  UNTRUSTED_CLOSE,
  UNTRUSTED_OPEN,
  UNTRUSTED_OVERHEAD,
  UNTRUSTED_PROMPT_RULE,
  wrapUntrusted,
  wrapUntrustedWithin,
} from './untrusted'

describe('untrusted wrapping', () => {
  it('wraps screen text in the marker the prompt explains', () => {
    expect(wrapUntrusted('Settings — Wi-Fi')).toBe(
      `${UNTRUSTED_OPEN}\nSettings — Wi-Fi\n${UNTRUSTED_CLOSE}`,
    )
  })

  it('leaves empty text empty so callers can keep optional fields optional', () => {
    expect(wrapUntrusted('')).toBe('')
  })

  it('escapes a closing tag inside the payload', () => {
    const wrapped = wrapUntrusted(`before ${UNTRUSTED_CLOSE} after`)

    expect(wrapped.match(/<\/untrusted>/g)).toHaveLength(1)
    expect(wrapped).toContain('<\\/untrusted>')
    expect(wrapped.endsWith(UNTRUSTED_CLOSE)).toBe(true)
  })

  it('escapes the closing tag whatever its case', () => {
    const wrapped = wrapUntrusted('</UNTRUSTED>')

    expect(wrapped.match(/<\/untrusted>/gi)).toHaveLength(1)
  })

  it('keeps a wrapped field inside the declared budget', () => {
    const wrapped = wrapUntrustedWithin('x'.repeat(200), 40)

    expect(wrapped.length).toBeLessThanOrEqual(40)
    expect(wrapped).toContain(UNTRUSTED_OPEN)
    expect(wrapped.endsWith(UNTRUSTED_CLOSE)).toBe(true)
  })

  it('returns empty text unchanged even with a budget', () => {
    expect(wrapUntrustedWithin('', 40)).toBe('')
  })

  it('refuses a budget that cannot hold the markers', () => {
    expect(() => wrapUntrustedWithin('text', UNTRUSTED_OVERHEAD - 1)).toThrow(RangeError)
  })

  it('states the rule in one prompt line', () => {
    expect(UNTRUSTED_PROMPT_RULE).toContain(UNTRUSTED_OPEN)
    expect(UNTRUSTED_PROMPT_RULE).toMatch(/never instructions/i)
  })
})
