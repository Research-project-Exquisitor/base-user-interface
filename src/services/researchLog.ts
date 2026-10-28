// SPDX-FileCopyrightText: 2026 Ujjwal Sharma and Omar Shahbaz Khan
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ClientLogEvent, EventTarget, EventType } from '@/types/logEvent'
import { getSessionId, mock, post } from './http'

let sequenceSession = ''
let nextSequence = 0

/** Capture a semantic event at its source, without blocking the interaction.
 * Phase 4 will add persistence, retries and deduplication to this transport.
 */
export function logEvent(
  type: EventType,
  target: EventTarget,
  data: Record<string, unknown>,
): ClientLogEvent | undefined {
  const session = getSessionId()
  if (mock || !session) return undefined
  if (session !== sequenceSession) {
    sequenceSession = session
    nextSequence = 0
  }
  const event: ClientLogEvent = {
    v: 1,
    event_id: crypto.randomUUID(),
    source: 'client',
    session_id: session,
    time: { client: Date.now() },
    sequence: nextSequence++,
    type,
    target,
    // Snapshot mutable inputs (seen lists, filters, results) at capture time.
    data: JSON.parse(JSON.stringify(data)),
  }
  void post('/exq/log/clientEventV2', [event]).catch((error: unknown) => {
    console.error('Research event delivery failed', error)
  })
  return event
}
