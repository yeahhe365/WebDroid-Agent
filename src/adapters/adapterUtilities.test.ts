import { describe, expect, it } from 'vitest'
import {
  encodeAdbKeyboardText,
  escapeInputText,
  findAdbKeyboardIme,
  isAdbKeyboardInstalled,
  isAndroidInputTextSafe,
} from './adbKeyboard'
import {
  DEFAULT_DEVICE_TIMING,
  DEFAULT_DOUBLE_TAP_INTERVAL_MS,
} from './deviceTiming'
import {
  buildInputCommand,
  buildInputCommandSequence,
  keyToAndroidKeyCode,
} from './inputCommands'
import { getSensitiveActionMessage } from './sensitiveActions'
import {
  buildDeleteScreenBrightnessCommand,
  buildDeleteScreenBrightnessModeCommand,
  buildReadScreenBrightnessCommand,
  buildReadScreenBrightnessModeCommand,
  buildSetScreenBrightnessCommand,
  buildSetScreenBrightnessModeCommand,
  normalizeScreenSetting,
} from './screenBlackoutCommands'
import {
  buildDisableStayAwakeCommand,
  buildEnableStayAwakeCommand,
  buildReadStayAwakeSettingCommand,
  buildRestoreStayAwakeSettingCommand,
  buildWakeDeviceCommand,
  normalizeStayAwakeSetting,
} from './stayAwakeCommands'
import {
  buildDumpScreenTreeCommand,
  buildReadScreenTreeCommand,
  buildRemoveScreenTreeCommand,
  formatScreenTreeForPrompt,
  parseUiAutomatorDumpXml,
} from './uiAutomator'
import {
  parseCurrentAppFromDumpsys,
  parseDeviceStateFromDumpsys,
  parsePngSize,
} from './deviceParsers'
import {
  parseInstalledAppsFromPackageOutput,
  resolveInstalledAppPackage,
  selectInstalledAppsForPrompt,
} from './installedApps'
import {
  resolveAppNameFromPackage,
  resolveAppPackage,
} from './appPackages'
import {
  retryDeviceOperation,
} from './deviceRetry'

describe('buildInputCommand', () => {
  it('builds tap commands', () => {
    expect(buildInputCommand({ action: 'tap', x: 12, y: 34 })).toEqual([
      'input',
      'tap',
      '12',
      '34',
    ])
  })

  it('builds swipe commands with duration', () => {
    expect(
      buildInputCommand({
        action: 'swipe',
        fromX: 1,
        fromY: 2,
        toX: 3,
        toY: 4,
        durationMs: 500,
      }),
    ).toEqual(['input', 'swipe', '1', '2', '3', '4', '500'])
  })

  it('builds text commands with Android input escaping', () => {
    expect(buildInputCommand({ action: 'input_text', text: 'hello world' })).toEqual([
      'input',
      'text',
      'hello%sworld',
    ])
  })

  it('builds keyevent commands', () => {
    expect(buildInputCommand({ action: 'key', key: 'BACK' })).toEqual([
      'input',
      'keyevent',
      'KEYCODE_BACK',
    ])
  })

  it('returns null for non-input actions', () => {
    expect(buildInputCommand({ action: 'wait', ms: 250 })).toBeNull()
    expect(buildInputCommand({ action: 'done' })).toBeNull()
  })
})

describe('stay-awake commands', () => {
  it('builds ADB commands for keeping the device awake while connected', () => {
    expect(buildReadStayAwakeSettingCommand()).toEqual([
      'settings',
      'get',
      'global',
      'stay_on_while_plugged_in',
    ])
    expect(buildEnableStayAwakeCommand()).toEqual(['svc', 'power', 'stayon', 'usb'])
    expect(buildDisableStayAwakeCommand()).toEqual(['svc', 'power', 'stayon', 'false'])
    expect(buildRestoreStayAwakeSettingCommand('3')).toEqual([
      'settings',
      'put',
      'global',
      'stay_on_while_plugged_in',
      '3',
    ])
    expect(buildWakeDeviceCommand()).toEqual(['input', 'keyevent', 'KEYCODE_WAKEUP'])
  })

  it('normalizes persisted stay-awake setting values', () => {
    expect(normalizeStayAwakeSetting('2\n')).toBe('2')
    expect(normalizeStayAwakeSetting('null')).toBeNull()
    expect(normalizeStayAwakeSetting('')).toBeNull()
  })
})

describe('screen blackout commands', () => {
  it('builds ADB commands for dimming and restoring the screen during auto control', () => {
    expect(buildReadScreenBrightnessCommand()).toEqual([
      'settings',
      'get',
      'system',
      'screen_brightness',
    ])
    expect(buildReadScreenBrightnessModeCommand()).toEqual([
      'settings',
      'get',
      'system',
      'screen_brightness_mode',
    ])
    expect(buildSetScreenBrightnessModeCommand('0')).toEqual([
      'settings',
      'put',
      'system',
      'screen_brightness_mode',
      '0',
    ])
    expect(buildSetScreenBrightnessCommand('0')).toEqual([
      'settings',
      'put',
      'system',
      'screen_brightness',
      '0',
    ])
    expect(buildDeleteScreenBrightnessCommand()).toEqual([
      'settings',
      'delete',
      'system',
      'screen_brightness',
    ])
    expect(buildDeleteScreenBrightnessModeCommand()).toEqual([
      'settings',
      'delete',
      'system',
      'screen_brightness_mode',
    ])
  })

  it('normalizes screen setting values from ADB output', () => {
    expect(normalizeScreenSetting('120\n')).toBe('120')
    expect(normalizeScreenSetting('null')).toBeNull()
    expect(normalizeScreenSetting('')).toBeNull()
  })
})

describe('ui automator screen tree utilities', () => {
  it('builds dump/read/remove commands and parses useful nodes', () => {
    expect(buildDumpScreenTreeCommand()).toEqual([
      'uiautomator',
      'dump',
      '--compressed',
      '/sdcard/webdroid-window-dump.xml',
    ])
    expect(buildReadScreenTreeCommand()).toEqual(['cat', '/sdcard/webdroid-window-dump.xml'])
    expect(buildRemoveScreenTreeCommand()).toEqual(['rm', '-f', '/sdcard/webdroid-window-dump.xml'])

    const tree = parseUiAutomatorDumpXml(`
      <hierarchy>
        <node index="0" text="" resource-id="" class="android.widget.FrameLayout" bounds="[0,0][1080,2400]" />
        <node index="1" text="Search" content-desc="Search field" resource-id="com.example:id/search" class="android.widget.EditText" clickable="true" focused="true" enabled="true" bounds="[24,100][1056,180]" />
      </hierarchy>
    `)

    expect(tree.nodes[1]).toEqual({
      index: 1,
      text: 'Search',
      contentDescription: 'Search field',
      resourceId: 'com.example:id/search',
      className: 'android.widget.EditText',
      clickable: true,
      focused: true,
      enabled: true,
      bounds: { left: 24, top: 100, right: 1056, bottom: 180 },
    })
    expect(tree).not.toHaveProperty('rawXml')
    expect(formatScreenTreeForPrompt(tree)).toContain('center=(540,140)')
    expect(formatScreenTreeForPrompt(tree)).toContain('text="Search"')
  })
})

describe('buildInputCommandSequence', () => {
  it('builds launch commands from package names and app labels', () => {
    expect(buildInputCommandSequence({ action: 'launch', app: 'Settings' })).toEqual([
      ['monkey', '-p', 'com.android.settings', '-c', 'android.intent.category.LAUNCHER', '1'],
    ])
    expect(buildInputCommandSequence({ action: 'launch', app: 'com.example.app' })).toEqual([
      ['monkey', '-p', 'com.example.app', '-c', 'android.intent.category.LAUNCHER', '1'],
    ])
  })

  it('builds launch commands from installed app labels', () => {
    expect(
      buildInputCommandSequence({ action: 'launch', app: 'Notes' }, DEFAULT_DEVICE_TIMING, [
        { label: 'Notes', packageName: 'com.example.notes' },
      ]),
    ).toEqual([
      ['monkey', '-p', 'com.example.notes', '-c', 'android.intent.category.LAUNCHER', '1'],
    ])
  })

  it('builds long press and double tap command sequences', () => {
    expect(
      buildInputCommandSequence({ action: 'long_press', x: 10, y: 20, durationMs: 900 }),
    ).toEqual([
      ['input', 'swipe', '10', '20', '10', '20', '900'],
    ])

    expect(buildInputCommandSequence({ action: 'double_tap', x: 10, y: 20 })).toEqual([
      ['input', 'tap', '10', '20'],
      { waitMs: DEFAULT_DOUBLE_TAP_INTERVAL_MS },
      ['input', 'tap', '10', '20'],
    ])
  })

  it('builds back and home commands', () => {
    expect(buildInputCommandSequence({ action: 'back' })).toEqual([
      ['input', 'keyevent', 'KEYCODE_BACK'],
    ])
    expect(buildInputCommandSequence({ action: 'home' })).toEqual([
      ['input', 'keyevent', 'KEYCODE_HOME'],
    ])
  })

  it('builds primitive touch and text command sequences without global settle waits', () => {
    expect(buildInputCommandSequence({ action: 'tap', x: 12, y: 34 })).toEqual([
      ['input', 'tap', '12', '34'],
    ])

    expect(
      buildInputCommandSequence({
        action: 'swipe',
        fromX: 1,
        fromY: 2,
        toX: 3,
        toY: 4,
        durationMs: 500,
      }),
    ).toEqual([
      ['input', 'swipe', '1', '2', '3', '4', '500'],
    ])

    expect(buildInputCommandSequence({ action: 'input_text', text: 'hello world' })).toEqual([
      ['input', 'text', 'hello%sworld'],
    ])

    expect(buildInputCommandSequence({ action: 'open_url', url: 'https://example.com' })).toEqual([
      ['am', 'start', '-a', 'android.intent.action.VIEW', '-d', "'https://example.com'"],
    ])

    expect(buildInputCommandSequence({ action: 'paste' })).toEqual([
      ['input', 'keyevent', 'KEYCODE_PASTE'],
    ])

    expect(buildInputCommandSequence({ action: 'set_clipboard', text: 'hello' })).toEqual([])

    expect(
      buildInputCommandSequence({ action: 'input_text', text: 'hello world', clear: true }),
    ).toEqual([
      ['input', 'keycombination', 'KEYCODE_CTRL_LEFT', 'KEYCODE_A'],
      { waitMs: DEFAULT_DEVICE_TIMING.keyboardStepMs },
      ['input', 'keyevent', 'KEYCODE_DEL'],
      { waitMs: DEFAULT_DEVICE_TIMING.keyboardStepMs },
      ['input', 'text', 'hello%sworld'],
    ])
  })

  it('uses custom double-tap timing when provided', () => {
    expect(
      buildInputCommandSequence(
        { action: 'double_tap', x: 10, y: 20 },
        {
          ...DEFAULT_DEVICE_TIMING,
          actionSettleMs: 250,
          doubleTapIntervalMs: 80,
        },
      ),
    ).toEqual([
      ['input', 'tap', '10', '20'],
      { waitMs: 80 },
      ['input', 'tap', '10', '20'],
    ])
  })
})

describe('escapeInputText', () => {
  it('escapes whitespace for Android input text', () => {
    expect(escapeInputText(' a  b ')).toBe('%sa%s%sb%s')
  })

  it('detects text that Android input text can type reliably', () => {
    expect(isAndroidInputTextSafe('hello world 123')).toBe(true)
    expect(isAndroidInputTextSafe('test@example.com')).toBe(true)
    expect(isAndroidInputTextSafe('测试发送')).toBe(false)
    expect(isAndroidInputTextSafe('hello\nworld')).toBe(false)
    expect(isAndroidInputTextSafe('price is $5')).toBe(false)
  })

  it('detects whether ADB Keyboard is installed from ime list output', () => {
    expect(
      isAdbKeyboardInstalled(`com.android.inputmethod.latin/.LatinIME\ncom.android.adbkeyboard/.AdbIME`),
    ).toBe(true)
    expect(isAdbKeyboardInstalled('com.zhipu.autoglm.keyboard/.AdbIME')).toBe(true)
    expect(isAdbKeyboardInstalled('com.autoglm.keyboard/.AutoGLMKeyboardIME')).toBe(true)
    expect(isAdbKeyboardInstalled('com.android.inputmethod.latin/.LatinIME')).toBe(false)
  })

  it('selects the detected AutoGLM-compatible keyboard IME', () => {
    expect(
      findAdbKeyboardIme(`com.android.inputmethod.latin/.LatinIME\ncom.zhipu.autoglm.keyboard/.AdbIME`),
    ).toBe('com.zhipu.autoglm.keyboard/.AdbIME')
    expect(findAdbKeyboardIme('com.autoglm.keyboard/.AutoGLMKeyboardIME')).toBe(
      'com.autoglm.keyboard/.AutoGLMKeyboardIME',
    )
  })

  it('encodes Unicode text for ADB Keyboard base64 input', () => {
    expect(encodeAdbKeyboardText('测试发送')).toBe('5rWL6K+V5Y+R6YCB')
    expect(encodeAdbKeyboardText('hello world')).toBe('aGVsbG8gd29ybGQ=')
  })
})

describe('keyToAndroidKeyCode', () => {
  it('maps supported model keys to Android keycodes', () => {
    expect(keyToAndroidKeyCode('APP_SWITCH')).toBe('KEYCODE_APP_SWITCH')
  })
})

describe('resolveAppPackage', () => {
  it('maps common app names to Android packages', () => {
    expect(resolveAppPackage('京东')).toBe('com.jingdong.app.mall')
    expect(resolveAppPackage('B站')).toBe('tv.danmaku.bili')
    expect(resolveAppPackage('哔哩哔哩')).toBe('tv.danmaku.bili')
    expect(resolveAppPackage('YouTube')).toBe('com.google.android.youtube')
    expect(resolveAppPackage('JD.com')).toBe('com.jingdong.app.mall')
    expect(resolveAppPackage('com.example.app')).toBe('com.example.app')
  })

  it('keeps package display names independent from app alias order', () => {
    expect(resolveAppNameFromPackage('com.jingdong.app.mall')).toBe('京东')
    expect(resolveAppNameFromPackage('com.google.android.apps.maps')).toBe('maps')
    expect(resolveAppNameFromPackage('com.twitter.android')).toBe('x')
    expect(resolveAppNameFromPackage('tv.danmaku.bili')).toBe('哔哩哔哩')
    expect(resolveAppNameFromPackage('com.bilibili.app.in')).toBe('bilibili')
  })
})

describe('installed app parsing and matching', () => {
  it('parses launcher activities from Android package query output', () => {
    const apps = parseInstalledAppsFromPackageOutput(`
ResolveInfo:
  ActivityInfo:
    name=com.google.android.gm.ConversationListActivityGmail
    packageName=com.google.android.gm
    nonLocalizedLabel=Gmail
ResolveInfo:
  ActivityInfo:
    name=com.android.settings.Settings
    packageName=com.android.settings
    nonLocalizedLabel=null
com.android.chrome/com.google.android.apps.chrome.Main
package:com.example.notes
`)

    expect(apps).toEqual([
      {
        packageName: 'com.google.android.gm',
        activity: 'com.google.android.gm.ConversationListActivityGmail',
        label: 'Gmail',
      },
      {
        packageName: 'com.android.settings',
        activity: 'com.android.settings.Settings',
      },
      {
        packageName: 'com.android.chrome',
        activity: 'com.google.android.apps.chrome.Main',
      },
      {
        packageName: 'com.example.notes',
      },
    ])
  })

  it('ignores Android dump metadata when app labels are null or followed by icon fields', () => {
    const apps = parseInstalledAppsFromPackageOutput(`
ResolveInfo:
  ActivityInfo:
    name=com.android.mms.ui.ConversationList
    packageName=com.android.mms
    nonLocalizedLabel=null icon=0x0 banner=0x0
ResolveInfo:
  ActivityInfo:
    name=com.coloros.gallery3d.app.Gallery
    packageName=com.coloros.gallery3d
    nonLocalizedLabel='相册' icon=0x7f110005 banner=0x0
`)

    expect(apps).toEqual([
      {
        packageName: 'com.android.mms',
        activity: 'com.android.mms.ui.ConversationList',
      },
      {
        packageName: 'com.coloros.gallery3d',
        activity: 'com.coloros.gallery3d.app.Gallery',
        label: '相册',
      },
    ])
  })

  it('matches natural app names against installed labels, aliases, and package tokens', () => {
    const apps = parseInstalledAppsFromPackageOutput(`
      packageName=com.google.android.gm
      nonLocalizedLabel=Gmail
      packageName=com.android.chrome
      packageName=com.android.mms
      packageName=com.coloros.gallery3d
      packageName=com.example.notes
      packageName=tv.danmaku.bili
    `)

    expect(resolveInstalledAppPackage('Gmail', apps)).toBe('com.google.android.gm')
    expect(resolveInstalledAppPackage('浏览器', apps)).toBe('com.android.chrome')
    expect(resolveInstalledAppPackage('短信', apps)).toBe('com.android.mms')
    expect(resolveInstalledAppPackage('相册', apps)).toBe('com.coloros.gallery3d')
    expect(resolveInstalledAppPackage('notes', apps)).toBe('com.example.notes')
    expect(resolveInstalledAppPackage('com.example.notes', apps)).toBe('com.example.notes')
    expect(resolveInstalledAppPackage('B站', apps)).toBe('tv.danmaku.bili')
  })

  it('matches Bilibili aliases against alternate installed packages', () => {
    expect(
      resolveInstalledAppPackage('B站', [
        { packageName: 'com.example.app' },
        { packageName: 'com.bilibili.app.in' },
      ]),
    ).toBe('com.bilibili.app.in')
  })

  it('prioritizes apps mentioned by the user before truncating prompt app lists', () => {
    const apps = [
      ...Array.from({ length: 48 }, (_, index) => ({
        packageName: `com.example.app${index}`,
      })),
      { packageName: 'tv.danmaku.bili' },
    ]

    const selected = selectInstalledAppsForPrompt(apps, '打开 B 站', 40)

    expect(selected).toHaveLength(40)
    expect(selected[0].packageName).toBe('tv.danmaku.bili')
  })

  it('keeps every installed app for prompts when no limit is provided', () => {
    const apps = Array.from({ length: 48 }, (_, index) => ({
      packageName: `com.example.app${index}`,
    }))

    const selected = selectInstalledAppsForPrompt(apps, '打开 app47')

    expect(selected).toHaveLength(48)
    expect(selected.map((app) => app.packageName)).toContain('com.example.app47')
    expect(selected.map((app) => app.packageName)).toContain('com.example.app0')
  })
})

describe('parseCurrentAppFromDumpsys', () => {
  it('detects the focused package and maps it to a known app label', () => {
    const output = 'mCurrentFocus=Window{abc u0 com.tencent.mm/.ui.LauncherUI}'

    expect(parseCurrentAppFromDumpsys(output)).toBe('微信')
  })

  it('returns the package name when the focused app is unknown', () => {
    const output = 'mFocusedApp=ActivityRecord{abc u0 com.example.notes/.MainActivity t12}'

    expect(parseCurrentAppFromDumpsys(output)).toBe('com.example.notes')
  })

  it('falls back to System Home when no focus line is present', () => {
    expect(parseCurrentAppFromDumpsys('no focused window')).toBe('System Home')
  })

  it('skips focus lines without a package and keeps looking', () => {
    const output = [
      'mCurrentFocus=null',
      'mFocusedApp=ActivityRecord{abc u0 com.android.chrome/com.google.android.apps.chrome.Main t12}',
    ].join('\n')

    expect(parseCurrentAppFromDumpsys(output)).toBe('chrome')
  })
})

describe('parseDeviceStateFromDumpsys', () => {
  it('extracts app label, package, activity, and orientation', () => {
    const output = [
      'mCurrentFocus=Window{abc u0 com.tencent.mm/.ui.LauncherUI}',
      'mCurrentAppOrientation=1',
    ].join('\n')

    expect(parseDeviceStateFromDumpsys(output)).toEqual({
      app: '微信',
      packageName: 'com.tencent.mm',
      activity: '.ui.LauncherUI',
      orientation: 'portrait',
    })
  })

  it('uses package names for unknown apps and detects landscape orientation', () => {
    const output = [
      'mFocusedApp=ActivityRecord{abc u0 com.example.notes/com.example.notes.MainActivity t12}',
      'mCurrentAppOrientation=0',
    ].join('\n')

    expect(parseDeviceStateFromDumpsys(output)).toEqual({
      app: 'com.example.notes',
      packageName: 'com.example.notes',
      activity: 'com.example.notes.MainActivity',
      orientation: 'landscape',
    })
  })
})

describe('getSensitiveActionMessage', () => {
  it('asks for confirmation on sensitive tap actions', () => {
    expect(
      getSensitiveActionMessage({
        action: 'tap',
        x: 100,
        y: 200,
        message: '确认付款',
      }),
    ).toBe('确认付款')
    expect(
      getSensitiveActionMessage({
        action: 'tap',
        x: 100,
        y: 200,
        risk: 'sensitive',
      }),
    ).toBe('Sensitive tap at (100, 200)')
  })
})

describe('parsePngSize', () => {
  it('extracts PNG dimensions from the IHDR chunk', () => {
    const png = new Uint8Array(24)
    png.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
    png[16] = 0x00
    png[17] = 0x00
    png[18] = 0x04
    png[19] = 0x38
    png[20] = 0x00
    png[21] = 0x00
    png[22] = 0x09
    png[23] = 0x60

    expect(parsePngSize(png)).toEqual({ width: 1080, height: 2400 })
  })

  it('rejects non-PNG bytes', () => {
    expect(() => parsePngSize(new Uint8Array([1, 2, 3]))).toThrow('PNG')
  })
})

describe('retryDeviceOperation', () => {
  it('retries transient state failures with delays and one recovery hook', async () => {
    const delays: number[] = []
    let attempts = 0
    let recoveries = 0

    const result = await retryDeviceOperation(
      async () => {
        attempts += 1
        if (attempts < 4) {
          throw new Error(`state read failed ${attempts}`)
        }
        return 'ready'
      },
      {
        label: 'device state',
        maxAttempts: 4,
        retryDelaysMs: [10, 20, 30],
        recoverAfterAttempt: 2,
        recover: async () => {
          recoveries += 1
        },
        wait: async (ms) => {
          delays.push(ms)
        },
      },
    )

    expect(result).toBe('ready')
    expect(attempts).toBe(4)
    expect(recoveries).toBe(1)
    expect(delays).toEqual([10, 20, 30])
  })

  it('throws a contextual error after all retry attempts fail', async () => {
    let attempts = 0

    await expect(
      retryDeviceOperation(
        async () => {
          attempts += 1
          throw new Error('dumpsys unavailable')
        },
        {
          label: 'device state',
          maxAttempts: 3,
          retryDelaysMs: [1],
          wait: async () => {},
        },
      ),
    ).rejects.toThrow('Failed to get device state after 3 attempts: dumpsys unavailable')
    expect(attempts).toBe(3)
  })
})
