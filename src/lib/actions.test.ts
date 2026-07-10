import { describe, expect, it } from 'vitest'
import { buildActionPreview } from './actionPreview'
import { parseModelAction, validateAction } from './actionParser'
import { ActionValidationError } from './actionTypes'

const screen = { width: 1080, height: 2400 }

describe('parseModelAction', () => {
  it('extracts a JSON object from a fenced model response', () => {
    const action = parseModelAction('```json\n{"action":"tap","x":320,"y":700,"reason":"open"}\n```')

    expect(action).toEqual({
      action: 'tap',
      x: 320,
      y: 700,
      reason: 'open',
    })
  })

  it('rejects non-JSON model responses', () => {
    expect(() => parseModelAction('tap the center of the screen')).toThrow(ActionValidationError)
  })

  it('rejects function-style model responses', () => {
    expect(() => parseModelAction('<answer>do(action="Launch", app="京东")</answer>')).toThrow(
      ActionValidationError,
    )
    expect(() => parseModelAction('complete(success=False, message="没有找到目标")')).toThrow(
      ActionValidationError,
    )
  })

  it('rejects XML tool call responses', () => {
    expect(
      () =>
        parseModelAction(
          [
            '<function_calls>',
            '<invoke name="click_at">',
            '<parameter name="x">100</parameter>',
            '<parameter name="y">200</parameter>',
            '</invoke>',
            '</function_calls>',
          ].join(''),
          screen,
        ),
    ).toThrow(ActionValidationError)
  })

  it('rejects JSON objects that use removed protocol coordinates', () => {
    expect(() =>
      parseModelAction(
        '{"_metadata":"do","action":"Tap","element":[500,100],"thought":"press search"}',
        screen,
      ),
    ).toThrow('Action must include x/y coordinates')
  })

  it('maps normalized 0-1000 touch coordinates to screenshot pixels', () => {
    expect(
      parseModelAction(
        '{"action":"tap","x":500,"y":1000,"reason":"open bottom"}',
        screen,
        'webdroid_normalized_json',
      ),
    ).toEqual({
      action: 'tap',
      x: 540,
      y: 2399,
      reason: 'open bottom',
    })
  })

  it('maps normalized composite touch actions to screenshot pixels', () => {
    expect(
      parseModelAction(
        JSON.stringify({
          action: 'sequence',
          actions: [
            { action: 'tap', x: 250, y: 500 },
            { action: 'swipe', fromX: 500, fromY: 900, toX: 500, toY: 100 },
          ],
          reason: 'tap and scroll',
        }),
        screen,
        'webdroid_normalized_json',
      ),
    ).toEqual({
      action: 'sequence',
      actions: [
        { action: 'tap', x: 270, y: 1200 },
        {
          action: 'swipe',
          fromX: 540,
          fromY: 2159,
          toX: 540,
          toY: 240,
          durationMs: 400,
        },
      ],
      reason: 'tap and scroll',
    })
  })

  it('rejects normalized touch coordinates outside 0-1000', () => {
    expect(() =>
      parseModelAction(
        '{"action":"tap","x":1001,"y":500}',
        screen,
        'webdroid_normalized_json',
      ),
    ).toThrow('normalized 0-1000 coordinate range')
  })
})

describe('validateAction', () => {
  it('accepts tap coordinates within the screen bounds', () => {
    expect(validateAction({ action: 'tap', x: 1079, y: 2399 }, screen)).toEqual({
      action: 'tap',
      x: 1079,
      y: 2399,
    })
  })

  it('rejects tap coordinates outside the screen bounds', () => {
    expect(() => validateAction({ action: 'tap', x: 1080, y: 200 }, screen)).toThrow(
      'outside the current screen',
    )
  })

  it('normalizes wait durations to a safe range', () => {
    expect(validateAction({ action: 'wait' }, screen)).toEqual({
      action: 'wait',
      ms: 1000,
    })
    expect(validateAction({ action: 'wait', duration: 1.5 }, screen)).toEqual({
      action: 'wait',
      ms: 1500,
    })
    expect(validateAction({ action: 'wait', ms: 99 }, screen)).toEqual({
      action: 'wait',
      ms: 100,
    })
    expect(validateAction({ action: 'wait', ms: 70000 }, screen)).toEqual({
      action: 'wait',
      ms: 10000,
    })
  })

  it('accepts screenshot recall actions by ref or step', () => {
    expect(validateAction({ action: 'view_screenshot', ref: '#4' }, screen)).toEqual({
      action: 'view_screenshot',
      ref: '#4',
    })
    expect(validateAction({ action: 'view_screenshot', step: '5' }, screen)).toEqual({
      action: 'view_screenshot',
      step: 5,
    })
    expect(parseModelAction('{"action":"view_screenshot","ref":"step-6"}', screen)).toEqual({
      action: 'view_screenshot',
      ref: 'step-6',
    })
  })

  it('rejects input text with control characters', () => {
    expect(() => validateAction({ action: 'input_text', text: 'hello\nworld' }, screen)).toThrow(
      'control characters',
    )
  })

  it('accepts clear-before-type input actions', () => {
    expect(validateAction({ action: 'input_text', text: 'hello', clear: true }, screen)).toEqual({
      action: 'input_text',
      text: 'hello',
      clear: true,
    })
    expect(parseModelAction('{"action":"input_text","text":"hello","clear":true}', screen)).toEqual({
      action: 'input_text',
      text: 'hello',
      clear: true,
    })
  })

  it('accepts URL, clipboard, and paste actions', () => {
    expect(validateAction({ action: 'open_url', url: 'https://example.com/search?q=webdroid' })).toEqual({
      action: 'open_url',
      url: 'https://example.com/search?q=webdroid',
    })
    expect(validateAction({ action: 'set_clipboard', text: '测试 hello' })).toEqual({
      action: 'set_clipboard',
      text: '测试 hello',
    })
    expect(validateAction({ action: 'paste' })).toEqual({ action: 'paste' })
  })

  it('rejects unsafe URL and clipboard actions', () => {
    expect(() => validateAction({ action: 'open_url', url: 'example.com' }, screen)).toThrow(
      'scheme must be one of',
    )
    expect(() => validateAction({ action: 'open_url', url: 'myapp://detail/123' }, screen)).toThrow(
      'scheme must be one of',
    )
    expect(() => validateAction({ action: 'set_clipboard', text: 'bad\0text' }, screen)).toThrow(
      'control characters',
    )
  })

  it('rejects non-boolean input clear values', () => {
    expect(() =>
      validateAction({ action: 'input_text', text: 'hello', clear: 'yes' }, screen),
    ).toThrow('clear must be a boolean')
  })

  it('rejects unsupported action names', () => {
    expect(() => validateAction({ action: 'shell', command: 'rm -rf /' }, screen)).toThrow(
      'Unsupported action',
    )
  })

  it('accepts bounded sequence and repeat actions', () => {
    expect(
      validateAction(
        {
          action: 'sequence',
          actions: [
            { action: 'tap', x: 100, y: 200 },
            { action: 'input_text', text: 'hello' },
          ],
          reason: 'fill form',
        },
        screen,
      ),
    ).toEqual({
      action: 'sequence',
      actions: [
        { action: 'tap', x: 100, y: 200 },
        { action: 'input_text', text: 'hello' },
      ],
      reason: 'fill form',
    })

    expect(
      validateAction(
        {
          action: 'repeat',
          count: 3,
          actionToRepeat: {
            action: 'swipe',
            fromX: 540,
            fromY: 1800,
            toX: 540,
            toY: 600,
          },
          delayMs: 250,
        },
        screen,
      ),
    ).toEqual({
      action: 'repeat',
      count: 3,
      actionToRepeat: {
        action: 'swipe',
        fromX: 540,
        fromY: 1800,
        toX: 540,
        toY: 600,
        durationMs: 400,
      },
      delayMs: 250,
    })
  })

  it('rejects unsafe or unbounded composite actions', () => {
    expect(() =>
      validateAction({ action: 'repeat', count: 11, actionToRepeat: { action: 'back' } }, screen),
    ).toThrow('between 1 and 10')

    expect(() =>
      validateAction({
        action: 'sequence',
        actions: [{ action: 'tap', x: 100, y: 200 }, { action: 'done' }],
      }, screen),
    ).toThrow('cannot be used inside a composite action')

    expect(() =>
      validateAction({
        action: 'sequence',
        actions: [{ action: 'view_screenshot', step: 1 }],
      }, screen),
    ).toThrow('cannot be used inside a composite action')

    expect(() =>
      validateAction({
        action: 'repeat',
        count: 2,
        actionToRepeat: {
          action: 'sequence',
          actions: [{ action: 'back' }],
        },
      }, screen),
    ).toThrow('Composite actions cannot be nested')
  })

  it('preserves sensitive tap metadata for confirmation before execution', () => {
    expect(
      validateAction(
        {
          action: 'tap',
          x: 100,
          y: 200,
          message: '确认支付',
          risk: 'sensitive',
        },
        screen,
      ),
    ).toEqual({
      action: 'tap',
      x: 100,
      y: 200,
      message: '确认支付',
      risk: 'sensitive',
    })
  })

  it('accepts canonical control actions', () => {
    expect(validateAction({ action: 'Launch', app: 'Settings' }, screen)).toEqual({
      action: 'launch',
      app: 'Settings',
    })
    expect(validateAction({ action: 'Back' }, screen)).toEqual({ action: 'back' })
    expect(validateAction({ action: 'Home' }, screen)).toEqual({ action: 'home' })
    expect(validateAction({ action: 'Long Press', x: 540, y: 1200 }, screen)).toEqual({
      action: 'long_press',
      x: 540,
      y: 1200,
      durationMs: 800,
    })
    expect(validateAction({ action: 'Double Tap', x: 270, y: 1800 }, screen)).toEqual({
      action: 'double_tap',
      x: 270,
      y: 1800,
    })
    expect(validateAction({ action: 'Take_over', message: 'login required' }, screen)).toEqual({
      action: 'take_over',
      message: 'login required',
    })
    expect(validateAction({ action: 'Note', message: 'record page' }, screen)).toEqual({
      action: 'note',
      message: 'record page',
    })
  })

  it('rejects removed protocol aliases and coordinate payloads', () => {
    expect(() => validateAction({ action: 'click_at', x: 100, y: 200 }, screen)).toThrow(
      'Unsupported action',
    )
    expect(() => validateAction({ action: 'tap', coordinate: [100, 200] }, screen)).toThrow(
      'x/y coordinates',
    )
    expect(() => validateAction({ action: 'swipe', direction: 'up' }, screen)).toThrow(
      'fromX/fromY/toX/toY',
    )
    expect(() => validateAction({ action: 'type_text', text: 'hello' }, screen)).toThrow(
      'Unsupported action',
    )
    expect(() => validateAction({ action: 'system_button', button: 'recent apps' }, screen)).toThrow(
      'Unsupported action',
    )
    expect(() => validateAction({ action: 'open_app', text: 'Gmail' }, screen)).toThrow(
      'Unsupported action',
    )
    expect(() => validateAction({ action: 'remember', information: '账号页已打开' }, screen)).toThrow(
      'Unsupported action',
    )
    expect(validateAction({ action: 'custom_tool', tool: 'lookup_order' }, screen)).toEqual({
      action: 'custom_tool',
      tool: 'lookup_order',
    })
    expect(validateAction({ action: 'open_url', url: 'https://example.com' }, screen)).toEqual({
      action: 'open_url',
      url: 'https://example.com',
    })
    expect(validateAction({ action: 'set_clipboard', text: 'hello' }, screen)).toEqual({
      action: 'set_clipboard',
      text: 'hello',
    })
    expect(validateAction({ action: 'paste' }, screen)).toEqual({
      action: 'paste',
    })
  })
})

describe('buildActionPreview', () => {
  it('formats actions for manual review', () => {
    const preview = buildActionPreview({
      action: 'swipe',
      fromX: 400,
      fromY: 1800,
      toX: 400,
      toY: 500,
      durationMs: 450,
      reason: 'scroll list',
    })

    expect(preview).toBe('swipe (400, 1800) -> (400, 500), 450ms - scroll list')
  })

  it('formats launch and takeover actions', () => {
    expect(buildActionPreview({ action: 'launch', app: 'Settings' })).toBe('launch Settings')
    expect(buildActionPreview({ action: 'input_text', text: 'query', clear: true })).toBe(
      'replace text with "query"',
    )
    expect(buildActionPreview({ action: 'open_url', url: 'https://example.com' })).toBe(
      'open url https://example.com',
    )
    expect(buildActionPreview({ action: 'set_clipboard', text: 'copy me' })).toBe(
      'set clipboard "copy me"',
    )
    expect(buildActionPreview({ action: 'paste' })).toBe('paste')
    expect(
      buildActionPreview({
        action: 'sequence',
        actions: [
          { action: 'tap', x: 100, y: 200 },
          { action: 'input_text', text: 'hello' },
        ],
      }),
    ).toBe('sequence 2 action(s): tap (100, 200); input text "hello"')
    expect(
      buildActionPreview({
        action: 'repeat',
        count: 2,
        actionToRepeat: { action: 'back' },
        delayMs: 100,
      }),
    ).toBe('repeat 2x back, 100ms delay')
    expect(buildActionPreview({ action: 'take_over', message: 'captcha' })).toBe(
      'take over: captcha',
    )
    expect(buildActionPreview({ action: 'interact', message: 'choose one' })).toBe(
      'interact: choose one',
    )
    expect(buildActionPreview({ action: 'call_api', instruction: 'summarize' })).toBe(
      'call api: summarize',
    )
    expect(buildActionPreview({ action: 'view_screenshot', step: 4 })).toBe(
      'view screenshot step #4',
    )
  })
})
