// SPDX-FileCopyrightText: 2026 Ujjwal Sharma and Omar Shahbaz Khan
// SPDX-License-Identifier: AGPL-3.0-or-later
import { searchTemporal } from "@/services/searchApi"
import { ChatQuery } from "@/types/chat"
import { ExqTemporalChain, ExqTemporalHop, ExqTemporalSearchRequest } from "@/types/exq"
import { ILSets } from "@/types/mediaitem"
import { defineStore } from "pinia"
import { useAppStore } from "./app"
import { useModelStore } from "./model"
import { useChatStore } from "./chat"
import { useItemStore } from "./item"

export const useTemporalSearchStore = defineStore('temporalSearch', () => {
  const isOpen = ref(false)
  const temporalSelection = ref<ChatQuery[]>([])
  const loadingResults = ref(false)
  // Kept between dialog openings, the server's n counts videos and -1 chains per video keeps them all
  const maxVideos = ref(100)
  const chainsPerVideo = ref(3)

  const modelStore = useModelStore()
  const chatStore = useChatStore()
  const itemStore = useItemStore()

  function open(tempSelection: ChatQuery[]) {
    temporalSelection.value = tempSelection
    isOpen.value = true
    loadingResults.value = false
  }
  
  function close() {
    isOpen.value = false
  }
  
  async function search(orderedSelection: ChatQuery[]): Promise<number[]> {
    const modelId = modelStore.activeModel!.id
    const chat = chatStore.getOrCreateChat(modelId)
    const hops = orderedSelection.map(toHop)

    // A repeated search goes back to its entry, the hops hold each event's text, index and filters
    const hopsKey = JSON.stringify(hops)
    const existing = chat.find((c) => (
      c.searchType === 'temporal' &&
      JSON.stringify(c.hops) === hopsKey &&
      c.maxVideos === maxVideos.value &&
      c.chainsPerVideo === chainsPerVideo.value
    ))
    if (existing) {
      chatStore.currentQueryId = existing.id
      return existing.resultIds
    }

    const reqObj: ExqTemporalSearchRequest = {
      session_info: {
        session: useAppStore().session,
        modelId: modelId,
        collection: modelStore.getModelCollection(modelId)
      },
      n: maxVideos.value,
      hops: hops,
      chains_per_video: chainsPerVideo.value,
      excluded: itemStore.getSetItems(modelId, ILSets.Excluded).map(item => item.id),
      seen: [],
    }

    loadingResults.value = true
    let chains: ExqTemporalChain[]
    try {
      chains = (await searchTemporal(reqObj)).suggestions
    } finally {
      loadingResults.value = false
    }
    // The grid works on item ids so the chains are flattened in rank order
    const resultIds = [...new Set(chains.flatMap(c => c.items))]

    let text = orderedSelection[0].name + ", " + orderedSelection[1].name
    if (orderedSelection.length > 2) {
      text += ", ..."
    }
    chat.push({
      id: generateUniqueId(),
      name: "Temporal Search (" + text + ")",
      text: orderedSelection.map(q => q.text).join(" || "),
      timestamp: Date.now(),
      resultIds: resultIds,
      searchType: 'temporal',
      searchModel: 'clip',
      // Each hop carries its own filters
      filters: undefined,
      chains: chains,
      hops: hops,
      maxVideos: maxVideos.value,
      chainsPerVideo: chainsPerVideo.value
    })
    chatStore.currentQueryId = chat[chat.length - 1].id

    return resultIds
  }
    
  return {
    isOpen,
    temporalSelection,
    loadingResults,
    maxVideos,
    chainsPerVideo,
    open,
    close,
    search
  }
})
  
// Image searches will map to kind 'query' and RF history entries to kind 'rf' here once they can be selected
function toHop(q: ChatQuery): ExqTemporalHop {
  return {
    kind: 'query',
    text: q.text,
    ...(q.indexName !== undefined && { index_name: q.indexName }),
    ...(q.filters !== undefined && { filters: q.filters }),
  }
}

function generateUniqueId() {
  return crypto.randomUUID()
}