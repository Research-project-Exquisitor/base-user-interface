// SPDX-FileCopyrightText: 2026 Ujjwal Sharma and Omar Shahbaz Khan
// SPDX-License-Identifier: AGPL-3.0-or-later
import { getMainURI } from "@/services/ExquisitorAPI"
import { defineStore } from "pinia"
import { ref, reactive, computed, watch } from "vue"
import { recordResearchEvent } from "@/services/researchLog"
import { startRecording as startRecordingSession, stopRecording as stopRecordingSession } from "@/services/recording"
import { useModelStore } from "./model"
import { useItemStore } from "./item"

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

  // Settings change what the participant sees or can do (R11), so each change is
  // logged with its new and previous value, wherever it was made (settings form,
  // theme button). The thumbnail size is the result grid's tile width.
  function logSetting(setting: string, value: unknown, previous: unknown) {
    recordResearchEvent('display_change', 'session', { change: 'setting', setting, value, previous })
  }
  watch(themeId, (value, previous) => logSetting('theme', value, previous))
  watch(globalThumbSize, (value, previous) => logSetting('thumbnail_size', value, previous))
  watch(submitButtonsOn, (value, previous) => logSetting('submit_buttons', value, previous))
  watch(() => selectedEvaluation.value.id, (value, previous) => logSetting('evaluation', value, previous))

  // Recorded sessions (D32). A recording can start mid-use, so session_start
  // carries the state a replay needs to begin from: settings, open tabs and
  // the item open in the viewer. The result grid logs its results itself.
  function startRecording() {
    const modelStore = useModelStore()
    const itemStore = useItemStore()
    session.value = startRecordingSession({
      collections: collections.value.map(c => c.name),
      settings: {
        theme: themeId.value, thumbnail_size: globalThumbSize.value,
        submit_buttons: submitButtonsOn.value, evaluation: selectedEvaluation.value.id,
      },
      models: modelStore.models.map(m => ({ id: m.id, name: m.name, collection: m.collection, settings: m.settings })),
      active_model: modelStore.activeModel?.id ?? null,
      // The item open in the viewer of the active tab, if any
      selected_item: modelStore.activeModel ? itemStore.getSelectedItem()?.id ?? null : null,
    })
  }

  function stopRecording() {
    stopRecordingSession()
  }

  return {
    startRecording,
    stopRecording,
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