// SPDX-FileCopyrightText: 2026 Ujjwal Sharma and Omar Shahbaz Khan
// SPDX-License-Identifier: AGPL-3.0-or-later
import { reactive } from 'vue'
import { recordResearchEvent } from './researchLog'
import { setRecording, setSessionId } from './http'
import { logPageStateAtSessionStart } from './pageState'
import { load, save } from './recordingStorage'

/** Recorded sessions (research-workspace D32). Research events are logged only
 * while a recording is on, started and ended with the Record button.
 *
 * A recording belongs to one browser tab. It is kept in sessionStorage, so it
 * survives reloads and in-app navigation, stays separate per tab (two tabs
 * never share a sequence), and ends with the tab. Its id is the session id, so
 * the engine's own events for its searches land in the same file.
 *
 * Each page load has a page id. A reload logs `page_end` when the page goes and
 * `page_start` on the next one; a recording without `session_end` ended with
 * its tab (or was lost).
 */

export function newSessionId(): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  return Array.from(bytes, (b) => characters[b % characters.length]).join('')
}

/** This page load. */
export const pageId: string = newSessionId()

/** For the Record button. */
export const recordingState = reactive({ on: false, id: '', startedAt: 0 })

const snapshotHooks = new Set<() => void>()

/** For components that show state: called when a recording starts, so one
 * started mid-use logs what is already on screen. Returns the unregister. */
export function onRecordingStart(hook: () => void): () => void {
  snapshotHooks.add(hook)
  return () => snapshotHooks.delete(hook)
}

function navigationType(): string | null {
  try {
    const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    return entry?.type ?? null
  } catch {
    return null
  }
}

/** On page load: continues this tab's recording, if there is one, and returns
 * its id. Logs `page_start` with the page's state. */
export function resumeRecording(): string | undefined {
  const stored = load()
  if (!stored) return undefined
  setSessionId(stored.id)
  setRecording(true)
  Object.assign(recordingState, { on: true, id: stored.id, startedAt: stored.startedAt })
  recordResearchEvent('page_start', 'session', { page_id: pageId, navigation: navigationType(), path: location.pathname })
  logPageStateAtSessionStart('page_start')
  return stored.id
}

/** Starts a recording with a new session id; `state` is the state at its start
 * (settings, open tabs), logged with `session_start`. Returns the id. */
export function startRecording(state: Record<string, unknown>): string {
  const id = newSessionId()
  const startedAt = Date.now()
  setSessionId(id)
  save({ id, startedAt, sequence: 0 })
  setRecording(true)
  Object.assign(recordingState, { on: true, id, startedAt })
  recordResearchEvent('session_start', 'session', {
    reason: 'user_started', page_id: pageId, path: location.pathname, ...state,
  })
  logPageStateAtSessionStart('session_start')
  snapshotHooks.forEach((hook) => hook())
  return id
}

/** Ends the recording: `session_end`, then nothing more is logged. */
export function stopRecording(): void {
  if (!recordingState.on) return
  recordResearchEvent('session_end', 'session', {
    reason: 'user_ended', page_id: pageId, duration_ms: Date.now() - recordingState.startedAt,
  })
  setRecording(false)
  save(undefined)
  Object.assign(recordingState, { on: false })
}

let installed = false
/** Logs `page_end` when the page goes (reload, navigation, tab close); call
 * once when the app starts. Sent with keepalive, as the page is hidden by then. */
export function installRecording(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('pagehide', () => {
    if (recordingState.on) recordResearchEvent('page_end', 'session', { page_id: pageId })
  })
}
