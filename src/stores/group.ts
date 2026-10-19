// SPDX-FileCopyrightText: 2026 Ujjwal Sharma and Omar Shahbaz Khan
// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineStore } from 'pinia'
import { reactive } from 'vue'
import { useFilterStore } from '@/stores/filter'
import { useAppStore } from '@/stores/app'
import { getItem } from '@/services/ExquisitorAPI'
import type { GroupMetadata } from '@/types/mediaitem'


function key(collection: string, groupId: number) {
  return `${collection}:${groupId}`
}

// Single cache of group (video) info, shared by the result grid and the media viewer
export const useGroupStore = defineStore('group', () => {
  const filterStore = useFilterStore()
  const appStore = useAppStore()

  // Cache of collection+groupId to GroupMetadata.
  // Deep reactive because related items are filled in after the group loads.
  const groupMetadata = reactive(new Map<string, GroupMetadata>())
  const inflight = new Map<string, Promise<GroupMetadata>>()

  function get(collection: string, groupId: number): GroupMetadata | null {
    return groupMetadata.get(key(collection, groupId)) ?? null
  }

  /**
   * Fetch group info and metadata for a (collection, groupId) in one /item/info call.
   * Concurrent callers share the same request.
   */
  function fetchGroupInfo(collection: string, groupId: number, modelId: number): Promise<GroupMetadata> {
    const k = key(collection, groupId)
    const existing = groupMetadata.get(k)
    if (existing) return Promise.resolve(existing)

    let p = inflight.get(k)
    if (!p) {
      const filterIds = filterStore.tagsetIds(collection, [...filterStore.mainGroupTagsets, ...filterStore.otherGroupTagsets])
      p = getItem(appStore.session, groupId, modelId, collection, { filterIds })
        .then((info) => {
          groupMetadata.set(k, {
            src: info.srcPath,
            groupMediaType: info.mediaType,
            items: [],
            metadata: info.metadata ?? {}
          })
          return groupMetadata.get(k)!
        })
        .finally(() => inflight.delete(k))
      inflight.set(k, p)
    }
    return p
  }

  /**
   * Prefetch many groups (used by ResultGrid).
   * TODO (future batch endpoint) Replace Promise.all with one call for all groupIds.
   */
  async function fetchGroupsInfo(collection: string, groupIds: number[], modelId: number) {
    const unique = Array.from(new Set(groupIds)).filter((g) => g != null && g !== -1)
    const missing = unique.filter((g) => !groupMetadata.has(key(collection, g)))
    if (missing.length === 0) return

    await Promise.all(missing.map((g) => fetchGroupInfo(collection, g, modelId)))
  }

  return {
    groupMetadata,
    get,
    fetchGroupInfo,
    fetchGroupsInfo
  }
})
