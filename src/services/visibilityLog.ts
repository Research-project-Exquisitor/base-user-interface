// SPDX-FileCopyrightText: 2026 Ujjwal Sharma and Omar Shahbaz Khan
// SPDX-License-Identifier: AGPL-3.0-or-later
import { recordResearchEvent } from './researchLog'

/** Which result tiles are on screen (R18, D26), reported by the browser
 * instead of rebuilt from scroll positions and layout.
 *
 * One IntersectionObserver watches every tile, with the browser viewport as
 * root, so tiles scrolled out of a panel or hidden behind its edge count as
 * out of view. A change is logged when a tile crosses 0, 50% or 100% in view.
 * The browser reports crossings in batches, once per drawn frame; each batch
 * is one `visibility_change` event listing its tiles. No minimum time on
 * screen: whether a tile counts as seen is decided in the analysis (R21).
 *
 * A tile removed while in view (new results, a closed dialog) gets a closing
 * entry with `cause: removed`, so every time in view has an end. Tiles in a
 * dialog that is closing count as out of view: the dialog is going away, and
 * rows it still renders during its closing animation were never looked at.
 */

export type TileInfo = { item_id: number; surface?: string; model_id: number; collection?: string; request_id?: string }
type Change = TileInfo & { ratio: number; cause?: 'removed' }

const THRESHOLDS = [0, 0.5, 1]
const tiles = new Map<Element, TileInfo>()
const loggedBand = new Map<Element, number>()
let pendingRemovals: Change[] = []
let observer: IntersectionObserver | undefined

/** 0 out of view, 1 partly, 2 at least half, 3 fully. Subpixel layout can
 * leave a fully visible tile at a ratio just under 1. */
function band(ratio: number, intersecting: boolean): number {
  if (!intersecting || ratio <= 0) return 0
  if (ratio >= 0.995) return 3
  return ratio >= 0.5 ? 2 : 1
}

function inClosingOverlay(el: Element): boolean {
  const overlay = el.closest('.v-overlay')
  return overlay !== null && !overlay.classList.contains('v-overlay--active')
}

function log(changes: Change[]): void {
  if (changes.length) recordResearchEvent('visibility_change', 'results', { changes })
}

function onEntries(entries: IntersectionObserverEntry[]): void {
  const changes: Change[] = []
  for (const entry of entries) {
    const info = tiles.get(entry.target)
    if (!info) continue
    const closing = inClosingOverlay(entry.target)
    const ratio = closing ? 0 : Math.round(entry.intersectionRatio * 100) / 100
    const now = band(ratio, entry.isIntersecting && !closing)
    // A tile first seen out of view was never on screen: nothing to log.
    if (now === (loggedBand.get(entry.target) ?? 0)) continue
    loggedBand.set(entry.target, now)
    changes.push({ ...info, ratio })
  }
  log(changes)
}

/** Starts watching a tile; returns the function that stops it. */
export function watchTileVisibility(el: Element, info: () => TileInfo): () => void {
  if (typeof IntersectionObserver === 'undefined') return () => {}
  observer ??= new IntersectionObserver(onEntries, { threshold: THRESHOLDS })
  tiles.set(el, info())
  observer.observe(el)
  return () => {
    observer?.unobserve(el)
    const current = tiles.get(el)
    tiles.delete(el)
    if (current && (loggedBand.get(el) ?? 0) > 0) {
      // Removed tiles are batched within the same task: replacing a grid of
      // 100 tiles is one event, logged before the new grid is drawn.
      if (!pendingRemovals.length) queueMicrotask(() => { log(pendingRemovals); pendingRemovals = [] })
      pendingRemovals.push({ ...current, ratio: 0, cause: 'removed' })
    }
    loggedBand.delete(el)
  }
}

/** Updates what a tile shows (e.g. its producing search) without re-observing. */
export function updateTileInfo(el: Element, info: TileInfo): void {
  if (tiles.has(el)) tiles.set(el, info)
}
