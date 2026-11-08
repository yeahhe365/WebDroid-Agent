import type { AgentTurn } from './agentThread'
import type { InteractionStreamItem } from './interactionStream'

export type ChatDisplayItem =
  | Extract<InteractionStreamItem, { type: 'message' }>
  | {
      type: 'run'
      id: string
      turns: AgentTurn[]
    }

/**
 * Turns arrive as one stream item per step. The chat shows them as one run
 * block, so group consecutive step items and leave messages in place.
 */
export function groupChatItems(items: readonly InteractionStreamItem[]): ChatDisplayItem[] {
  const grouped: ChatDisplayItem[] = []

  for (const item of items) {
    if (item.type === 'message') {
      grouped.push(item)
      continue
    }

    const last = grouped[grouped.length - 1]
    if (last?.type === 'run') {
      last.turns.push(item.turn)
    } else {
      grouped.push({
        type: 'run',
        id: `run-${item.turn.id}`,
        turns: [item.turn],
      })
    }
  }

  return grouped
}

/** A short, human sentence for what this step was trying to do. */
export function turnNarrative(turn: AgentTurn): string {
  const reason = 'reason' in turn.action ? turn.action.reason?.trim() : ''
  if (reason) {
    return reason
  }

  switch (turn.action.action) {
    case 'input_text':
    case 'set_clipboard':
      return turn.action.text.trim()
    case 'open_url':
      return turn.action.url.trim()
    case 'take_over':
    case 'note':
    case 'interact':
      return turn.action.message.trim()
    case 'call_api':
      return turn.action.instruction.trim()
    case 'done':
      return turn.action.summary?.trim() || ''
    default:
      break
  }

  const preview = turn.preview.trim()
  const separator = preview.lastIndexOf(' - ')
  return separator >= 0 ? preview.slice(separator + 3).trim() : preview
}
