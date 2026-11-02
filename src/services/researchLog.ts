// SPDX-FileCopyrightText: 2026 Ujjwal Sharma and Omar Shahbaz Khan
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ClientLogEvent, EventTarget, EventType } from '@/types/logEvent'
import { getSessionId, mock, post } from './http'

let sequenceSession = ''
let nextSequence = 0

/** Capture a semantic event at its source, without blocking the interaction.
 * Phase 4 will add persistence, retries and deduplication to this transport.
 */
export function recordResearchEvent(
  type: EventType,
  target: EventTarget,
  data: Record<string, unknown>,
  requestId?: string,
): ClientLogEvent | undefined {
  const session = getSessionId()
  if (mock || !session) return undefined
  if (session !== sequenceSession) {
    sequenceSession = session
    nextSequence = 0
  }
  const event: ClientLogEvent = {
    type,
    target,
    source: 'client',
    time: { client: Date.now() },
    sequence: nextSequence++,
    request_id: requestId,
    session_id: session,
    event_id: crypto.randomUUID(),
    v: 1,
    // Snapshot mutable inputs (seen lists, filters, results) at capture time.
    data: JSON.parse(JSON.stringify(data)),
  }
  void post('/exq/log/clientEventV2', [event]).catch((error: unknown) => {
    console.error('Research event delivery failed', error)
  })
  return event
}

/** One change to a query box, logged raw: the full text after the change and
 * how it changed (the browser's inputType, e.g. insertText or insertFromPaste,
 * or 'clear' for the clear button). Not debounced, so no edit is lost.
 */
export function recordTextInput(surface: string, event: Event | 'clear', data: Record<string, unknown>): void {
  const input = event === 'clear' ? null : event.target as HTMLInputElement | null
  recordResearchEvent('text_input', 'search', {
    surface,
    text: input?.value ?? '',
    input_type: event === 'clear' ? 'clear' : (event as InputEvent).inputType ?? null,
    ...data,
  })
}
