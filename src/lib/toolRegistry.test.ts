import { describe, expect, it, vi } from 'vitest'
import type { DeviceBackend } from '../adapters/deviceBackend'
import { createDefaultActionToolRegistry } from './toolRegistry'

function fakeDevice(): DeviceBackend & { executed: string[] } {
  const executed: string[] = []
  return {
    executed,
    connect: vi.fn(),
    disconnect: vi.fn(),
    getCurrentApp: vi.fn(async () => 'Chrome'),
    getDeviceState: vi.fn(async () => ({ app: 'Chrome' })),
    screenshot: vi.fn(async () => ({
      bytes: new Uint8Array(),
      dataUrl: 'data:image/png;base64,abc',
      screen: { width: 1080, height: 2400 },
    })),
    execute: vi.fn(async (action) => {
      executed.push(action.action)
      return `${action.action} executed`
    }),
  }
}

describe('ActionToolRegistry', () => {
  it('exposes action signatures from one registry', () => {
    const registry = createDefaultActionToolRegistry()
    const signatures = registry.getSignatures()

    expect(signatures.tap.description).toContain('Tap')
    expect(signatures.tap.parameters.x).toEqual(
      expect.objectContaining({ required: true, type: 'number' }),
    )
    expect(signatures.input_text.parameters.text).toEqual(
      expect.objectContaining({ required: true, type: 'string' }),
    )
  })

  it('executes device actions through one normalized result shape', async () => {
    const device = fakeDevice()
    const registry = createDefaultActionToolRegistry()

    const result = await registry.execute(
      { action: 'tap', x: 100, y: 200 },
      { device },
    )

    expect(result).toEqual({
      success: true,
      summary: 'tap executed',
      toolName: 'tap',
    })
    expect(device.executed).toEqual(['tap'])
  })

  it('normalizes disabled tools without touching the device', async () => {
    const device = fakeDevice()
    const registry = createDefaultActionToolRegistry(['tap'])

    const result = await registry.execute(
      { action: 'tap', x: 100, y: 200 },
      { device },
    )

    expect(result.success).toBe(false)
    expect(result.summary).toContain('disabled')
    expect(device.executed).toEqual([])
  })
})
