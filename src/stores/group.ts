// SPDX-FileCopyrightText: 2026 Ujjwal Sharma and Omar Shahbaz Khan
// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineStore } from 'pinia'
import { reactive } from 'vue'
import { useFilterStore } from '@/stores/filter'
import { useAppStore } from '@/stores/app'
import { getItem, getItems } from '@/services/itemApi'
import type { GroupMetadata } from '@/types/mediaitem'
import type MediaItem from '@/types/mediaitem'


function key(collection: string, groupId: number) {
  return `${collection}:${groupId}`
}

function toGroupMetadata(info: MediaItem): GroupMetadata {
  return {
    src: info.srcPath,
    groupMediaType: info.mediaType,
    items: [],
    metadata: info.metadata ?? {}
  }
}

// Single cache of group (video) info, shared by the result grid and the media viewer
export const useGroupStore = defineStore('group', () => {
  const filterStore = useFilterStore()
  const appStore = useAppStore()

  // Cache of collection+groupId to GroupMetadata.
  // Deep reactive because related items are filled in after the group loads.
  const groupMetadata = reactive(new Map<string, GroupMetadata>())
  const inflight = new Map<string, Promise<GroupMetadata | undefined>>()

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
      p = getItem(appStore.session, groupId, modelId, collection, { filterIds: groupFilterIds(collection) })
        .then((info) => {
          groupMetadata.set(k, toGroupMetadata(info))
          return groupMetadata.get(k)!
        })
        .finally(() => inflight.delete(k))
      inflight.set(k, p)
    }
    // A batch from fetchGroupsInfo leaves out groups the collection doesn't have
    return p.then((group) => {
      if (!group) throw new Error(`Group ${groupId} not found in ${collection}`)
      return group
    })
  }

  /**
   * Prefetch many groups (used by ResultGrid) in one /item/info/batch call.
   * Groups another call is already loading wait on that call's request.
   */
  async function fetchGroupsInfo(collection: string, groupIds: number[], modelId: number) {
    const unique = Array.from(new Set(groupIds)).filter((g) => g != null && g !== -1)
    const toLoad = unique.filter((g) => !groupMetadata.has(key(collection, g)) && !inflight.has(key(collection, g)))

    if (toLoad.length > 0) {
      const batch = getItems(appStore.session, toLoad, modelId, collection, { filterIds: groupFilterIds(collection) })
        .then(({ items, missing }) => {
          if (missing.length > 0) console.warn(`Groups not found in ${collection}`, missing)
          for (const info of items) groupMetadata.set(key(collection, info.id), toGroupMetadata(info))
        })
        .finally(() => {
          for (const g of toLoad) inflight.delete(key(collection, g))
        })
      for (const g of toLoad) {
        inflight.set(key(collection, g), batch.then(() => groupMetadata.get(key(collection, g))))
      }
    }

    await Promise.all(unique.map((g) => inflight.get(key(collection, g))))
  }

  function groupFilterIds(collection: string): number[] {
    return filterStore.tagsetIds(collection, [...filterStore.mainGroupTagsets, ...filterStore.otherGroupTagsets])
  }

  return {
    groupMetadata,
    get,
    fetchGroupInfo,
    fetchGroupsInfo
  }
})
