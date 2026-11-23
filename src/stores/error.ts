// SPDX-FileCopyrightText: 2026 Ujjwal Sharma and Omar Shahbaz Khan
// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineStore } from 'pinia'
import { recordResearchEvent } from '@/services/researchLog'

export const useErrorStore = defineStore('error', () => {
  const visible = ref(false)
  const message = ref('')
  const detail = ref('')

  function show(err: unknown, requestDetail?: string) {
    const replaced = visible.value
    message.value = err instanceof Error ? err.message : String(err)
    detail.value = requestDetail ?? ''
    visible.value = true
    // The notice stays until dismissed and covers part of the screen (D30), and
    // not every error it shows logs an `error` event. A new error replaces the
    // message of one still shown.
    recordResearchEvent('display_change', 'session', {
      surface: 'error_notice', change: 'open', message: message.value, replaced,
    })
  }

  // Dismiss is the only way the notice goes: it has no timeout (MainView.vue).
  function dismiss() {
    if (visible.value) recordResearchEvent('display_change', 'session', { surface: 'error_notice', change: 'close' })
    visible.value = false
    detail.value = ''
  }

  return { visible, message, detail, show, dismiss }
})
