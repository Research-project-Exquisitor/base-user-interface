// SPDX-FileCopyrightText: 2026 Ujjwal Sharma and Omar Shahbaz Khan
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Where this tab's recording is kept (sessionStorage), apart from
 * `recording.ts` so the research logger can read it without Vue (D32). */

const KEY = 'exq.recording'
export interface Stored { id: string; startedAt: number; sequence: number }

function storage(): Storage | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage
  } catch {
    return undefined // storage blocked: the recording lasts until the page goes
  }
}

export function load(): Stored | undefined {
  try {
    const raw = storage()?.getItem(KEY)
    return raw ? JSON.parse(raw) as Stored : undefined
  } catch {
    return undefined
  }
}

export function save(stored: Stored | undefined): void {
  try {
    if (stored) storage()?.setItem(KEY, JSON.stringify(stored))
    else storage()?.removeItem(KEY)
  } catch { /* storage full or blocked */ }
}

/** The next sequence number of this tab's recording `id`, if it is stored. */
export function storedSequence(id: string): number | undefined {
  const stored = load()
  return stored?.id === id ? stored.sequence : undefined
}

/** Called for every event, so a reload continues the sequence. */
export function persistSequence(id: string, next: number): void {
  const stored = load()
  if (stored?.id === id) save({ ...stored, sequence: next })
}

