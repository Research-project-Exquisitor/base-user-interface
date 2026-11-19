// SPDX-FileCopyrightText: 2026 Ujjwal Sharma and Omar Shahbaz Khan
// SPDX-License-Identifier: AGPL-3.0-or-later
import { recordResearchEvent } from './researchLog'

/** Scroll gestures (Figure 1: Scroll, Summary Scroll; D26): one `scroll`
 * event when a container starts scrolling and one when it stops, with its
 * position at each. Positions in between are not logged: which results were
 * on screen comes from visibilityLog.ts.
 *
 * Listening on the document in the capture phase sees every scroll container
 * (result grid, history, related shots, dialogs) without wiring each one.
 * The browser's `scrollend` marks the end, so no guessed wait decides it.
 * Where `scrollend` doesn't exist (older Safari), the end is taken 150 ms
 * after the last scroll and marked `end_by: timeout`.
 *
 * Programmatic scrolls (e.g. a list reset to the top) are gestures too. Each
 * start records the last user input before it and how long before, so the
 * analysis can tell them apart; no rule is applied here (R21).
 */

const INPUTS = ['wheel', 'pointerdown', 'touchstart', 'keydown'] as const
const FALLBACK_END_MS = 150

let installed = false
let lastInput: { type: string; at: number } | undefined
const active = new WeakMap<Element, ReturnType<typeof setTimeout> | null>()

function containerOf(target: EventTarget | null): Element | null {
  if (target instanceof Document) return target.scrollingElement
  if (!(target instanceof Element)) return null
  // Text fields scroll their own text while typing; that isn't browsing.
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return null
  return target
}

function position(el: Element) {
  return {
    container: el.closest('[data-eid]')?.getAttribute('data-eid') ?? (el === document.scrollingElement ? 'page' : null),
    top: Math.round(el.scrollTop),
    left: Math.round(el.scrollLeft),
    scroll_height: el.scrollHeight,
    scroll_width: el.scrollWidth,
    client_height: el.clientHeight,
    client_width: el.clientWidth,
  }
}

function end(el: Element, endBy: 'scrollend' | 'timeout'): void {
  if (!active.has(el)) return
  const timer = active.get(el)
  if (timer) clearTimeout(timer)
  active.delete(el)
  recordResearchEvent('scroll', 'results', { phase: 'end', ...position(el), end_by: endBy })
}

function onScroll(event: Event): void {
  const el = containerOf(event.target)
  if (!el) return
  const fallback = !('onscrollend' in window)
  if (!active.has(el)) {
    const now = Date.now()
    recordResearchEvent('scroll', 'results', {
      phase: 'start', ...position(el),
      last_input: lastInput ? { type: lastInput.type, ms_before: now - lastInput.at } : null,
    })
    active.set(el, null)
  }
  if (fallback) {
    const timer = active.get(el)
    if (timer) clearTimeout(timer)
    active.set(el, setTimeout(() => end(el, 'timeout'), FALLBACK_END_MS))
  }
}

function onScrollEnd(event: Event): void {
  const el = containerOf(event.target)
  if (el) end(el, 'scrollend')
}

/** Starts listening; call once when the app starts. */
export function installScrollLogging(): void {
  if (installed || typeof document === 'undefined') return
  installed = true
  const options = { capture: true, passive: true }
  document.addEventListener('scroll', onScroll, options)
  document.addEventListener('scrollend', onScrollEnd, options)
  for (const type of INPUTS) {
    window.addEventListener(type, () => { lastInput = { type, at: Date.now() } }, options)
  }
}
