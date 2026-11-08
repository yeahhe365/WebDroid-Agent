// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { APP_COPY } from '../lib/appCopy'
import type { DeviceControlActions, DeviceControlState } from '../lib/deviceControlTypes'
import { DeviceToolsSection } from './DeviceToolsSection'

function createDeviceActions(): DeviceControlActions {
  return {
    onActionSettleMsChange: vi.fn(),
    onCaptureScreen: vi.fn(),
    onConfirmSensitiveActionsChange: vi.fn(),
    onConfigureAdbKeyboard: vi.fn(),
    onConnectDevice: vi.fn(),
    onDisconnectDevice: vi.fn(),
    onDoubleTapIntervalMsChange: vi.fn(),
    onKeyboardStepMsChange: vi.fn(),
    onLaunchInstalledApp: vi.fn(),
    onPreferAdbKeyboardChange: vi.fn(),
    onRunDirectAction: vi.fn(),
    onRunDoctor: vi.fn(),
  onSafetyStrictnessChange: vi.fn(),
    onUnrestrictedModeChange: vi.fn(),
  }
}

function createDeviceState(overrides: Partial<DeviceControlState> = {}): DeviceControlState {
  return {
    busyTask: null,
    connected: false,
    currentApp: 'Unknown',
    deviceInfo: null,
    doctorResults: [],
    deviceState: { app: 'Unknown' },
    installedApps: [],
    ...overrides,
  }
}

function renderDeviceToolsSection(overrides: Partial<DeviceControlState> = {}) {
  return render(
    <DeviceToolsSection
      actions={createDeviceActions()}
      copy={APP_COPY['en-US']}
      state={createDeviceState(overrides)}
    />,
  )
}

describe('DeviceToolsSection', () => {
  afterEach(() => {
    cleanup()
  })

  it('summarizes available tools instead of showing a static doctor label', () => {
    renderDeviceToolsSection()

    const badge = screen.getByText('3 tools')

    expect(badge.className).toContain('count')
    expect(screen.queryByText('Doctor checks')).toBeNull()
  })

  it('turns the tools badge into a warning when doctor results need attention', () => {
    renderDeviceToolsSection({
      doctorResults: [
        {
          id: 'webusb',
          title: 'WebUSB',
          status: 'ok',
          detail: 'Ready.',
        },
        {
          id: 'device',
          title: 'ADB connection',
          status: 'error',
          detail: 'No device.',
        },
      ],
    })

    const badge = screen.getByText('Check issues')

    expect(badge.className).toContain('warning')
  })
})
