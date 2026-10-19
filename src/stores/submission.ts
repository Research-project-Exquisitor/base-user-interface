// SPDX-FileCopyrightText: 2026 Ujjwal Sharma and Omar Shahbaz Khan
// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { ExqSubmissionResult } from '@/types/exq'

// Holds the latest submission result, shown by the snackbar in MainView
export const useSubmissionStore = defineStore('submission', () => {
  const visible = ref(false)
  const result = ref<ExqSubmissionResult | null>(null)
  // What was submitted, e.g. video + time window or Q&A text
  const label = ref('')

  const outcome = computed(() => {
    const s = result.value?.submission
    return s === 'CORRECT' ? 'correct' : s === 'WRONG' ? 'wrong' : 'other'
  })

  const color = computed(() =>
    outcome.value === 'correct' ? 'success' : outcome.value === 'wrong' ? 'error' : 'warning')

  const icon = computed(() =>
    outcome.value === 'correct' ? 'mdi-check-circle'
      : outcome.value === 'wrong' ? 'mdi-close-circle'
      : 'mdi-alert-circle')

  const title = computed(() => result.value?.submission || 'Unknown result')

  function show(res: ExqSubmissionResult, what = '') {
    result.value = res
    label.value = what
    visible.value = true
  }

  function dismiss() {
    visible.value = false
  }

  return { visible, result, label, color, icon, title, show, dismiss }
})
