// SPDX-FileCopyrightText: 2026 Ujjwal Sharma and Omar Shahbaz Khan
// SPDX-License-Identifier: AGPL-3.0-or-later
import { ref, watch } from "vue"
import { AdvancedSearchPayload } from "@/types/chat"
import { defineStore } from "pinia"
import { recordResearchEvent } from "@/services/researchLog"
import { useModelStore } from "./model"

export const useAdvancedSearchStore = defineStore('advancedSearch', () => {
  const isOpen = ref(false)

  const payload = ref<AdvancedSearchPayload>({
    queryName: '',
    queryText: '',
    searchType: 'text',
    searchModel: 'clip',
    filters: undefined,
    history: false,
  } as any)

  // Where the dialog was opened from, for the research log only
  type Opener = 'search_bar' | 'image_button' | 'history' | 'feedback_results'
  let openedFrom: Opener | undefined
  // Opened from a history entry: which one (D37)
  let openedQueryId: string | undefined

  function open(next: AdvancedSearchPayload, from?: Opener, queryId?: string) {
    payload.value = next
    openedFrom = from
    openedQueryId = queryId
    isOpen.value = true
  }

  function close() {
    isOpen.value = false
  }

  // Opening and closing the advanced search changes what's on screen (D29). The
  // store logs it, so every way counts: the search bar, the image button, History,
  // the feedback results, the close buttons, Escape and the backdrop.
  watch(isOpen, (open) => {
    const model = useModelStore().activeModel
    recordResearchEvent('display_change', 'search', {
      surface: 'advanced_search', change: open ? 'open' : 'close',
      ...(open ? { search_type: payload.value.searchType, opened_from: openedFrom ?? null, ...(openedQueryId ? { query_id: openedQueryId } : {}) } : {}),
      model_id: model?.id ?? null, collection: model?.collection ?? null,
    })
  })

  return { isOpen, payload, open, close }
})