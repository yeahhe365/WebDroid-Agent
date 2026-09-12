import { describe, expect, it } from 'vitest'
import { ActionValidationError } from './actionTypes'
import { DeviceBackendError } from '../adapters/deviceTypes'
import { OpenAiClientError } from './openAiErrors'
import {
  AUTO_RECOVERABLE_FAILURES,
  classifyThrownFailure,
  isAutoRecoverableExecutionFailure,
  isFailureClass,
} from './failureTaxonomy'

describe('classifyThrownFailure', () => {
  it('splits device errors by kind', () => {
    expect(classifyThrownFailure(new DeviceBackendError('adb failed'))).toBe('device_io')
    expect(classifyThrownFailure(new DeviceBackendError('slow', 'timeout'))).toBe('device_timeout')
  })

  it('classifies transport, validation and abort failures', () => {
    expect(classifyThrownFailure(new OpenAiClientError('429'))).toBe('model_transport')
    expect(classifyThrownFailure(new ActionValidationError('bad package'))).toBe('action_invalid')
    expect(classifyThrownFailure(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe('aborted')
  })

  it('honours an explicit force hint, because some error classes are module-private', () => {
    expect(classifyThrownFailure(new Error('not json'), { force: 'model_output' })).toBe('model_output')
  })

  it('lets the hint win over the error’s own type, not merely over unknown', () => {
    // Without a hint this classifies as device_timeout; if someone moves the
    // force check last, this assertion is what catches it.
    expect(classifyThrownFailure(new DeviceBackendError('slow', 'timeout'))).toBe('device_timeout')
    expect(
      classifyThrownFailure(new DeviceBackendError('slow', 'timeout'), { force: 'model_output' }),
    ).toBe('model_output')
  })

  it('falls back to unknown instead of guessing', () => {
    expect(classifyThrownFailure(new Error('mystery'))).toBe('unknown')
    expect(classifyThrownFailure('a string')).toBe('unknown')
  })
})

describe('auto-recoverable whitelist', () => {
  it('contains exactly the two transient device classes', () => {
    expect([...AUTO_RECOVERABLE_FAILURES].sort()).toEqual(['device_io', 'device_timeout'])
  })

  it('retries device failures but not unsupported or unknown ones', () => {
    expect(isAutoRecoverableExecutionFailure({ toolName: 'tap', success: false, summary: 'x', failureKind: 'device_timeout' })).toBe(true)
    expect(isAutoRecoverableExecutionFailure({ toolName: 'tap', success: false, summary: 'x', failureKind: 'device_io' })).toBe(true)
    expect(isAutoRecoverableExecutionFailure({ toolName: 'call_api', success: false, summary: 'x', failureKind: 'unsupported_action' })).toBe(false)
    expect(isAutoRecoverableExecutionFailure({ toolName: 'tap', success: false, summary: 'x' })).toBe(false)
  })
})

describe('isFailureClass', () => {
  it('accepts known classes and rejects everything else', () => {
    expect(isFailureClass('device_timeout')).toBe(true)
    expect(isFailureClass('device_unavailable')).toBe(false)
    expect(isFailureClass(42)).toBe(false)
  })
})
