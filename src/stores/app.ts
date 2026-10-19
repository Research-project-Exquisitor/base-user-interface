// SPDX-FileCopyrightText: 2026 Ujjwal Sharma and Omar Shahbaz Khan
// SPDX-License-Identifier: AGPL-3.0-or-later
import { getMainURI } from "@/services/ExquisitorAPI"
import { defineStore } from "pinia"
import { ref, reactive, computed } from "vue"

interface Collection {
  name: string
  description?: string
}

export type ThemeId = 'light' | 'graphiteDark' | 'softDark' | 'dark'

export const useAppStore = defineStore('app', () => {
  // existing
  const session = ref('')
  const collections = ref<Collection[]>([])
  const success = ref(true)
  const evaluations: {id: string, name: string}[] = reactive([])
  // ref (not reactive) so the settings v-model can replace the whole object
  // without leaving submitEnabled reading a stale one
  const selectedEvaluation = ref<{id: string, name: string}>({id: '', name: ''})
  const exqURI = getMainURI()

  // Submit buttons are only shown when switched on in settings
  // and there's an evaluation to submit to
  const submitButtonsOn = ref(true)
  const submitEnabled = computed(() => submitButtonsOn.value && selectedEvaluation.value.id !== '')

  // global UI settings
  const themeId = ref<ThemeId>('graphiteDark')
  const lastDarkThemeId = ref<Exclude<ThemeId, 'light'>>('graphiteDark') 
  const globalThumbSize = ref<number>(220)

  return {
    selectedEvaluation,
    submitButtonsOn,
    submitEnabled,
    session,
    collections,
    success,
    evaluations,
    exqURI,

    // UI settings
    themeId,
    lastDarkThemeId,
    globalThumbSize,
  }
})