import type { DeviceBackend, ExecuteActionOptions } from '../adapters/deviceBackend'
import type { AgentAction } from './actions'

export type ActionToolParameter = {
  type: 'string' | 'number' | 'boolean' | 'object' | 'list'
  required?: boolean
  description?: string
  default?: unknown
}

export type ActionToolSignature = {
  description: string
  parameters: Record<string, ActionToolParameter>
}

export type ActionToolResult = {
  toolName: string
  success: boolean
  summary: string
}

export type ActionToolContext = {
  device: DeviceBackend
  confirmSensitiveAction?: ExecuteActionOptions['confirmSensitiveAction']
}

type ActionToolName = AgentAction['action']

type ActionToolEntry<Action extends AgentAction = AgentAction> = ActionToolSignature & {
  execute: (action: Action, context: ActionToolContext) => Promise<string> | string
}

const DEFAULT_ACTION_TOOL_SIGNATURES: Record<ActionToolName, ActionToolSignature> = {
  launch: {
    description: 'Launch an Android app by common app name or package name.',
    parameters: {
      app: { type: 'string', required: true, description: 'Common app name or package name.' },
      packageName: { type: 'string', required: false, description: 'Resolved Android package name.' },
    },
  },
  tap: {
    description: 'Tap a screen coordinate.',
    parameters: {
      x: { type: 'number', required: true, description: 'Horizontal screen coordinate.' },
      y: { type: 'number', required: true, description: 'Vertical screen coordinate.' },
      message: { type: 'string', required: false, description: 'Optional confirmation message.' },
      risk: { type: 'string', required: false, description: 'Set to sensitive for risky taps.' },
    },
  },
  swipe: {
    description: 'Swipe from one screen coordinate to another.',
    parameters: {
      fromX: { type: 'number', required: true },
      fromY: { type: 'number', required: true },
      toX: { type: 'number', required: true },
      toY: { type: 'number', required: true },
      durationMs: { type: 'number', required: false, default: 400 },
    },
  },
  input_text: {
    description: 'Type text into the focused field.',
    parameters: {
      text: { type: 'string', required: true, description: 'Text to input.' },
    },
  },
  key: {
    description: 'Send an Android key event.',
    parameters: {
      key: { type: 'string', required: true, description: 'Supported Android key alias.' },
    },
  },
  back: {
    description: 'Press Android Back.',
    parameters: {},
  },
  home: {
    description: 'Press Android Home.',
    parameters: {},
  },
  long_press: {
    description: 'Long-press a screen coordinate.',
    parameters: {
      x: { type: 'number', required: true },
      y: { type: 'number', required: true },
      durationMs: { type: 'number', required: true },
    },
  },
  double_tap: {
    description: 'Double-tap a screen coordinate.',
    parameters: {
      x: { type: 'number', required: true },
      y: { type: 'number', required: true },
    },
  },
  wait: {
    description: 'Wait without touching the device.',
    parameters: {
      ms: { type: 'number', required: true, description: 'Milliseconds to wait.' },
    },
  },
  take_over: {
    description: 'Ask the user to take over manually.',
    parameters: {
      message: { type: 'string', required: true },
    },
  },
  note: {
    description: 'Record an observation without touching the device.',
    parameters: {
      message: { type: 'string', required: true },
    },
  },
  interact: {
    description: 'Ask the user for interaction or a choice.',
    parameters: {
      message: { type: 'string', required: true },
    },
  },
  call_api: {
    description: 'Request analysis or summarization from the agent context.',
    parameters: {
      instruction: { type: 'string', required: true },
    },
  },
  done: {
    description: 'Mark the task as complete.',
    parameters: {
      summary: { type: 'string', required: false },
    },
  },
}

export class ActionToolRegistry {
  #tools = new Map<ActionToolName, ActionToolEntry>()
  #disabled = new Set<ActionToolName>()

  constructor(disabledTools: readonly ActionToolName[] = []) {
    this.#disabled = new Set(disabledTools)
  }

  register<Action extends AgentAction>(
    name: Action['action'],
    entry: ActionToolEntry<Action>,
  ) {
    this.#tools.set(name, entry as ActionToolEntry)
  }

  disable(toolNames: readonly ActionToolName[]) {
    for (const name of toolNames) {
      this.#disabled.add(name)
    }
  }

  getSignatures(exclude: readonly ActionToolName[] = []) {
    const excluded = new Set(exclude)
    return Object.fromEntries(
      [...this.#tools.entries()]
        .filter(([name]) => !excluded.has(name) && !this.#disabled.has(name))
        .map(([name, entry]) => [
          name,
          {
            description: entry.description,
            parameters: entry.parameters,
          },
        ]),
    ) as Record<ActionToolName, ActionToolSignature>
  }

  async execute(action: AgentAction, context: ActionToolContext): Promise<ActionToolResult> {
    const toolName = action.action
    const entry = this.#tools.get(toolName)
    if (!entry) {
      return {
        toolName,
        success: false,
        summary: `Unknown tool: ${toolName}.`,
      }
    }

    if (this.#disabled.has(toolName)) {
      return {
        toolName,
        success: false,
        summary: `Tool "${toolName}" is disabled.`,
      }
    }

    try {
      const summary = await entry.execute(action, context)
      return {
        toolName,
        success: true,
        summary,
      }
    } catch (caught) {
      return {
        toolName,
        success: false,
        summary: caught instanceof Error ? caught.message : String(caught),
      }
    }
  }
}

export function createDefaultActionToolRegistry(disabledTools: readonly ActionToolName[] = []) {
  const registry = new ActionToolRegistry(disabledTools)

  for (const [name, signature] of Object.entries(DEFAULT_ACTION_TOOL_SIGNATURES)) {
    registry.register(name as ActionToolName, {
      ...signature,
      execute: (action, context) =>
        context.device.execute(action, {
          confirmSensitiveAction: context.confirmSensitiveAction,
        }),
    })
  }

  return registry
}
