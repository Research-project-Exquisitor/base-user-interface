// SPDX-FileCopyrightText: 2026 Ujjwal Sharma and Omar Shahbaz Khan
// SPDX-License-Identifier: AGPL-3.0-or-later
import { recordResearchEvent } from './researchLog'

/** What the page looks like to the participant: how big the window is, and
 * whether they can see and are using it. Needed to rebuild what was on screen
 * (R18): the result grid's columns and the panels' heights follow the window.
 *
 * - `viewport`: the window's size in CSS pixels and its device pixel ratio.
 *   Browser zoom changes all three; moving to another monitor can change only
 *   the ratio. While resizing, logged once per drawn frame, so each size that
 *   was drawn is logged and sizes in between frames are not (as D18).
 * - `page_visibility`: the tab is shown or hidden (tab switch, minimise,
 *   screen lock). Logged at once: a hidden page draws no frames.
 * - `window_focus`: the window gains or loses focus, e.g. switching to another
 *   app while the browser stays on screen, which visibility doesn't report.
 *
 * Each is logged at session start, so later changes apply to a known state.
 */

type Viewport = { width: number; height: number; device_pixel_ratio: number }

let installed = false
let loggedViewport = ''
let loggedVisible: boolean | undefined
let loggedFocused: boolean | undefined
let frameScheduled = false

function readViewport(): Viewport {
  return { width: window.innerWidth, height: window.innerHeight, device_pixel_ratio: window.devicePixelRatio }
}

type Start = 'session_start' | 'page_load'

function logViewport(cause: Start | 'resize'): void {
  const viewport = readViewport()
  const key = `${viewport.width}x${viewport.height}@${viewport.device_pixel_ratio}`
  if (key === loggedViewport) return
  if (recordResearchEvent('display_change', 'session', { change: 'viewport', ...viewport, cause })) loggedViewport = key
}

function logVisibility(cause: Start | 'visibilitychange'): void {
  const visible = document.visibilityState === 'visible'
  if (visible === loggedVisible) return
  if (recordResearchEvent('display_change', 'session', { change: 'page_visibility', visible, cause })) loggedVisible = visible
}

function logFocus(cause: Start | 'focus' | 'blur'): void {
  const focused = document.hasFocus()
  if (focused === loggedFocused) return
  if (recordResearchEvent('display_change', 'session', { change: 'window_focus', focused, cause })) loggedFocused = focused
}

function onResize(): void {
  if (frameScheduled) return
  frameScheduled = true
  // While hidden no frame is drawn; the size is logged when the tab is shown.
  requestAnimationFrame(() => {
    frameScheduled = false
    logViewport('resize')
  })
}

/** A change of device pixel ratio without a resize (another monitor) is only
 * reported through a media query for the current ratio, renewed on each change.
 */
function watchPixelRatio(): void {
  const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
  query.addEventListener('change', () => {
    onResize()
    watchPixelRatio()
  }, { once: true })
}

/** Starts listening; call once when the app starts. Events are only sent once
 * a session exists, so `logPageStateAtSessionStart` records the first state.
 */
export function installPageStateLogging(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('resize', onResize)
  watchPixelRatio()
  document.addEventListener('visibilitychange', () => {
    logVisibility('visibilitychange')
    // Showing the tab doesn't fire resize for a size changed while hidden.
    if (document.visibilityState === 'visible') onResize()
  })
  window.addEventListener('focus', () => logFocus('focus'))
  window.addEventListener('blur', () => logFocus('blur'))
}

/** Logs the current size, visibility and focus right after `session_start`,
 * or `page_load` when a recording continues after a reload. What an earlier
 * recording logged doesn't count: each one starts with the full state. */
export function logPageStateAtSessionStart(cause: Start = 'session_start'): void {
  if (typeof window === 'undefined') return
  loggedViewport = ''
  loggedVisible = undefined
  loggedFocused = undefined
  logViewport(cause)
  logVisibility(cause)
  logFocus(cause)
}
