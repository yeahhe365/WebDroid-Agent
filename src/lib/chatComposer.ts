const CHAT_COMPOSER_SELECTOR = 'textarea[name="chatMessage"]'

/** Focuses the chat composer textarea (used by the global focus shortcut). */
export function focusChatComposer() {
  document.querySelector<HTMLTextAreaElement>(CHAT_COMPOSER_SELECTOR)?.focus()
}
