// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { escapeInputText } from '../adapters/adbKeyboard'
import type { DeviceBackend, ExecuteActionOptions } from '../adapters/deviceTypes'
import type { AgentAction } from './actionTypes'
import { useAgentSessionHistory } from '../hooks/useAgentSessionHistory'
import { createAgentRunner, createAgentSession } from './agent'
import { createAgentThread, startThreadTurn, type AgentThread } from './agentThread'
import { APP_COPY } from './appCopy'
import { DEFAULT_SETTINGS } from './settings'
import { createIndexedDbThreadStore, createMemoryThreadStore } from './threadStore'
import { createDefaultActionToolRegistry } from './toolRegistry'

const SECRET_VALUE = 'SUPER-SECRET-CLEARTEXT-VALUE'
const MODEL_CONFIG = { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' }

/**
 * A device double that reports the argv it "sends", the way the WebADB backend
 * does from inside its command funnel: the recorder is the only reason the
 * collected argv exists, so this is what would have carried the secret.
 */
function argvReportingDevice() {
  const reported: string[][] = []
  const device: DeviceBackend = {
    connect: vi.fn(async () => ({ serial: 'device-1', name: 'Pixel' })),
    disconnect: vi.fn(async () => {}),
    screenshot: vi.fn(async () => ({
      bytes: new Uint8Array(),
      dataUrl: 'data:image/png;base64,abc',
      screen: { width: 1080, height: 2400 },
    })),
    getCurrentApp: vi.fn(async () => 'Chrome'),
    getDeviceState: vi.fn(async () => ({
      app: 'Chrome',
      packageName: 'com.android.chrome',
      keyboard: 'com.android.adbkeyboard/.AdbIME',
    })),
    execute: vi.fn(async (action: AgentAction, options?: ExecuteActionOptions) => {
      const argv =
        action.action === 'input_text'
          ? ['input', 'text', escapeInputText(action.text)]
          : [action.action]
      reported.push(argv)
      options?.onDeviceCommand?.(argv)
      return argv.join(' ')
    }),
  }
  return { device, reported }
}

async function runSecretStep() {
  const { device, reported } = argvReportingDevice()
  const session = createAgentSession('sign in')
  const result = await createAgentRunner({
    device,
    client: {
      completeAction: vi.fn(
        async () => '{"action":"type_secret","secretId":"login_password","clear":true}',
      ),
    },
    // The real registry is the point: the leak lived in its `type_secret` branch.
    toolRegistry: createDefaultActionToolRegistry(),
  }).run({
    modelConfig: MODEL_CONFIG,
    task: 'sign in',
    autoExecute: true,
    maxSteps: 1,
    session,
    secrets: [{ id: 'login_password', label: 'Password', value: SECRET_VALUE }],
    // Credential entry is classified as a take-over step, so the run has to be
    // in unrestricted mode for the action to reach the device funnel at all.
    // The leak lived in that funnel, not in the safety decision.
    unrestrictedMode: true,
  })
  return { result, session, reported }
}

const THREAD_DB = 'webdroid-agent-threads'
const RAW_THREAD_STORE = 'threads'

function withThreadDatabase<Result>(
  run: (database: IDBDatabase) => Promise<Result>,
): Promise<Result> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(THREAD_DB, 2)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(RAW_THREAD_STORE)) {
        database.createObjectStore(RAW_THREAD_STORE, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains('threadSummaries')) {
        database.createObjectStore('threadSummaries', { keyPath: 'id' })
      }
    }
    request.onsuccess = () => {
      const database = request.result
      run(database).then(
        (result) => {
          database.close()
          resolve(result)
        },
        (error: unknown) => {
          database.close()
          reject(error instanceof Error ? error : new Error(String(error)))
        },
      )
    }
    request.onerror = () => reject(request.error ?? new Error('Could not open thread database.'))
  })
}

function putRawThread(thread: AgentThread) {
  return withThreadDatabase(
    (database) =>
      new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(RAW_THREAD_STORE, 'readwrite')
        transaction.objectStore(RAW_THREAD_STORE).put(thread)
        transaction.oncomplete = () => resolve()
        transaction.onerror = () =>
          reject(transaction.error ?? new Error('Raw thread write failed.'))
      }),
  )
}

function getRawThread(threadId: string) {
  return withThreadDatabase(
    (database) =>
      new Promise<AgentThread | undefined>((resolve, reject) => {
        const request = database.transaction(RAW_THREAD_STORE, 'readonly').objectStore(RAW_THREAD_STORE).get(threadId)
        request.onsuccess = () => resolve(request.result as AgentThread | undefined)
        request.onerror = () => reject(request.error ?? new Error('Raw thread read failed.'))
      }),
  )
}

/** The thread a buggy version wrote: the argv of `type_secret` is the secret. */
function buggySecretThread(id: string): AgentThread {
  const thread = createAgentThread('sign in', { id, now: 1_000 })
  const turn = startThreadTurn(thread, {
    index: 1,
    runId: 'run_secret',
    task: thread.task,
    promptContext: 'context',
    deviceSnapshot: {
      currentApp: 'Chrome',
      deviceState: { app: 'Chrome', packageName: 'com.android.chrome' },
    },
    modelOutput: '{"action":"type_secret","secretId":"login_password"}',
    action: { action: 'type_secret', secretId: 'login_password' },
    executionAction: { action: 'type_secret', secretId: 'login_password' },
    preview: 'type secret',
    timing: { captureMs: 1, currentAppMs: 2, modelMs: 3, parseMs: 4, totalMs: 10 },
    status: 'executed',
  })
  turn.deviceCommands = [['input', 'text', escapeInputText(SECRET_VALUE)]]
  return thread
}

afterEach(() => {
  cleanup()
})

describe('secret containment', () => {
  it('keeps a resolved secret out of steps, turns, persistence and the chat-history export', async () => {
    const { result, session, reported } = await runSecretStep()

    // The double really did hand the secret to the device, so the assertions
    // below cannot pass for the wrong reason.
    expect(reported).toStrictEqual([['input', 'text', escapeInputText(SECRET_VALUE)]])
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0]?.action.action).toBe('type_secret')

    // No step and no turn carries it — in any field, not just deviceCommands.
    expect(JSON.stringify(result.steps)).not.toContain(SECRET_VALUE)
    expect(JSON.stringify(session.turns)).not.toContain(SECRET_VALUE)
    expect(result.steps[0]?.deviceCommands).toBeUndefined()
    expect(session.turns[0]?.deviceCommands).toBeUndefined()

    // What the thread store persists, and what it hands back through loadAll()
    // (the exact array `exportChatHistory` returns).
    const memoryStore = createMemoryThreadStore()
    await memoryStore.save(session)
    expect(JSON.stringify(await memoryStore.load(session.id))).not.toContain(SECRET_VALUE)
    expect(JSON.stringify(await memoryStore.loadAll())).not.toContain(SECRET_VALUE)

    // And the real export path: the chat-history button returns
    // `threadStore.loadAll()` straight from IndexedDB. The callbacks are stable
    // references on purpose: fresh closures would re-run the hook's restore
    // effect on every render.
    const store = createIndexedDbThreadStore()
    await store.clear()
    await store.save(session)
    const handleAddLog = () => {}
    const handleSessionStateChange = () => {}
    const history = renderHook(() =>
      useAgentSessionHistory({
        addLog: handleAddLog,
        copy: APP_COPY['en-US'],
        currentSettings: DEFAULT_SETTINGS,
        initialSettings: DEFAULT_SETTINGS,
        onSessionStateChange: handleSessionStateChange,
      }),
    )
    const exported = await waitFor(async () => {
      const value = await history.result.current.exportChatHistory()
      expect(value).not.toBeNull()
      return value as { count: number; threads: AgentThread[] }
    })
    expect(exported.count).toBeGreaterThan(0)
    expect(JSON.stringify(exported.threads)).not.toContain(SECRET_VALUE)
  })

  it('strips secret argv that an earlier version already stored, on write and on read', async () => {
    const store = createIndexedDbThreadStore()
    await store.clear()

    // Write path: what `save` puts into IndexedDB must already be clean, even
    // when the incoming thread still carries the buggy version's argv.
    const saved = buggySecretThread('thread-buggy-write')
    await store.save(saved)
    const rawStored = await getRawThread(saved.id)
    expect(JSON.stringify(rawStored)).not.toContain(SECRET_VALUE)

    // Read path: a thread that is already sitting in IndexedDB (written before
    // this fix) is sanitised by the runtime clone that `loadAll` / `load` use,
    // so it stops propagating without a migration.
    const stored = buggySecretThread('thread-buggy-read')
    await putRawThread(stored)
    const loaded = await store.load(stored.id)
    expect(JSON.stringify(loaded)).not.toContain(SECRET_VALUE)
    expect(JSON.stringify(await store.loadAll())).not.toContain(SECRET_VALUE)

    // The guard is shape-based, so a non-secret turn keeps its argv.
    const clean = createAgentThread('tap', { id: 'thread-clean', now: 2_000 })
    const cleanTurn = startThreadTurn(clean, {
      index: 1,
      runId: 'run_clean',
      task: clean.task,
      promptContext: 'context',
      deviceSnapshot: {
        currentApp: 'Chrome',
        deviceState: { app: 'Chrome', packageName: 'com.android.chrome' },
      },
      modelOutput: '{"action":"tap","x":1,"y":2}',
      action: { action: 'tap', x: 1, y: 2 },
      executionAction: { action: 'tap', x: 1, y: 2 },
      preview: 'tap (1, 2)',
      timing: { captureMs: 1, currentAppMs: 2, modelMs: 3, parseMs: 4, totalMs: 10 },
      status: 'executed',
    })
    cleanTurn.deviceCommands = [['input', 'tap', '1', '2']]
    await store.save(clean)
    expect((await getRawThread(clean.id))?.turns[0]?.deviceCommands).toStrictEqual([
      ['input', 'tap', '1', '2'],
    ])
  })
})
