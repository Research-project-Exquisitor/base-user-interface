// SPDX-FileCopyrightText: 2026 Ujjwal Sharma and Omar Shahbaz Khan
// SPDX-License-Identifier: AGPL-3.0-or-later
import { GroupMetadata, ILSets, } from "@/types/mediaitem";
import type MediaItem from "@/types/mediaitem";
import { defineStore } from "pinia";
import { reactive, ref } from "vue";
import { getItem, getItems, getRelatedItems } from "@/services/itemApi";
import { useAppStore } from "@/stores/app";
import { useModelStore } from "./model";
import { useFilterStore } from "./filter";
import { useGroupStore } from "./group";

type Metadata = Record<string, number | string | (number | string)[]>

export const useItemStore = defineStore('item', () => {
  // K = ItemId, V = MediaItem
  const items : Map<string, Map<number, MediaItem>> = reactive(new Map<string, Map<number,MediaItem>>())
  // K = modelId, V = Set<ItemId>
  const modelItems : Map<number, Set<number>> = reactive(new Map<number,Set<number>>())
  // modelId -> set -> (itemId -> addedAt)
  const setAddedAt = shallowReactive(new Map<number, Map<ILSets, Map<number, number>>>())
  
  const modelStore = useModelStore()
  const activeModel = reactive(computed(() => modelStore.activeModel))
  
  const selectedItem : Map<number, MediaItem> = reactive(new Map<number, MediaItem>())
  const selectedGroup : Map<number, GroupMetadata> = reactive(new Map<number, GroupMetadata>())
  // Set when the selected item's video info failed to load, so the viewer can say so
  const selectionFailed = ref(false)

  const filterStore = useFilterStore()
  const groupStore = useGroupStore()
  const appStore = useAppStore()

  // In-flight requests keyed by `${collection}/${itemId}`, so concurrent callers share one request
  const inflightBase = new Map<string, Promise<MediaItem | undefined>>()
  const inflightInfo = new Map<string, Promise<Metadata>>()

  // Item tagset whose value labels an item's group. All items of a group share it
  const groupKey = ref('Video ID')

  function collectionMap(collection: string): Map<number, MediaItem> {
    if (!items.has(collection)) items.set(collection, new Map<number, MediaItem>())
    return items.get(collection)!
  }

  function trackModelItems(modelId: number, itemIds: number[]) {
    if (!modelItems.has(modelId)) modelItems.set(modelId, new Set<number>())
    const tracked = modelItems.get(modelId)!
    itemIds.forEach(id => tracked.add(id))
  }

  // Base info for many items in one request, ids the collection doesn't have are left out of the result.
  // Aborting the signal cancels the running request, for example when the viewer switches to another video.
  async function fetchMediaItems(itemIds: number[], modelId: number, collection: string, signal?: AbortSignal) : Promise<MediaItem[]> {
    const colMap = collectionMap(collection)
    trackModelItems(modelId, itemIds)

    const toLoad = [...new Set(itemIds)].filter(id => !colMap.has(id) && !inflightBase.has(`${collection}/${id}`))
    if (toLoad.length > 0) loadBaseItems(toLoad, modelId, collection, signal)

    // Ids an earlier call is already loading wait on that call's request
    await Promise.all(itemIds.map(id => inflightBase.get(`${collection}/${id}`)))

    for (const id of itemIds) ensureItemSetEntry(id, modelId)
    return itemIds.flatMap(id => colMap.get(id) ?? [])
  }

  // Every id is marked in flight with a promise on the one batch request
  function loadBaseItems(itemIds: number[], modelId: number, collection: string, signal?: AbortSignal) {
    const filterIds = filterStore.tagsetIds(collection, [groupKey.value])
    const batch = getItems(appStore.session, itemIds, modelId, collection, { filterIds, signal })
      .then(({ items: loaded, missing }) => {
        if (missing.length > 0) console.warn(`Items not found in ${collection}`, missing)
        const colMap = collectionMap(collection)
        for (const it of loaded) {
          // Keep only the group key, since metadata being set means all item tagsets are loaded
          const val = it.metadata?.[groupKey.value]
          if (val != null && val !== '') it.groupKey = Array.isArray(val) ? val.join(', ') : String(val)
          delete it.metadata
          // Keep the cached item if its metadata arrived while this was in flight
          if (!colMap.has(it.id)) colMap.set(it.id, it)
        }
      })
      .finally(() => {
        for (const id of itemIds) inflightBase.delete(`${collection}/${id}`)
      })
    for (const id of itemIds) {
      inflightBase.set(`${collection}/${id}`, batch.then(() => collectionMap(collection).get(id)))
    }
  }
  
  function ensureItemSetEntry(exqId: number, modelId: number) {
    const collection = modelStore.getModelCollection(modelId)
    const it = items.get(collection)?.get(exqId)
    if (!it) return // or throw, or fetch synchronously (not recommended)
    
    if (!it.currentSets) it.currentSets = new Map()
      if (!it.currentSets.has(modelId)) it.currentSets.set(modelId, [false, false, false, false])
  }
  
  function addItemToSet(itemId: number, modelId: number, ilset: ILSets) : void {
    // When adding an item to a set, we need to ensure it is removed from any mutually exclusive sets 
    // and update the addedAt timestamp for the set
    const now = Date.now()
    const map = setAddedAtMap(modelId, ilset)
    if (!map.has(itemId)) map.set(itemId, now)

    if (ilset === ILSets.Positives) {
      setAddedAtMap(modelId, ILSets.Negatives).delete(itemId)
      setAddedAtMap(modelId, ILSets.History).delete(itemId)
    } else if (ilset === ILSets.Negatives) {
      setAddedAtMap(modelId, ILSets.Positives).delete(itemId)
      setAddedAtMap(modelId, ILSets.History).delete(itemId)
    } else if (ilset === ILSets.History) {
      setAddedAtMap(modelId, ILSets.Positives).delete(itemId)
      setAddedAtMap(modelId, ILSets.Negatives).delete(itemId)
    } 

    // console.log('Adding Item:', itemId, 'to set', ilset, 'for model', modelId)
    const collection = modelStore.getModelCollection(modelId)
    ensureItemSetEntry(itemId, modelId)
    const sets = items.get(collection)!.get(itemId)!.currentSets!.get(modelId)!
    switch (ilset) {
      case ILSets.Positives:
        sets[ILSets.Positives] = true
        sets[ILSets.Negatives] = false
        sets[ILSets.History] = false
        return
      case ILSets.Negatives:
        sets[ILSets.Positives] = false
        sets[ILSets.Negatives] = true
        sets[ILSets.History] = false
        return
      case ILSets.History:
        sets[ILSets.Positives] = false
        sets[ILSets.Negatives] = false
        sets[ILSets.History] = true
        return
      case ILSets.Submitted:
        sets[ILSets.Submitted] = true
        return
      default:
        sets[ilset] = true
    }     
  }
  
  function addItemsToSet(itemIds: number[], modelId: number, ilset: ILSets) : boolean {
    const collection = modelStore.getModelCollection(modelId)
    itemIds.forEach((v,_) => {
      items.get(collection)!.get(v)!.currentSets!.get(modelId)![ilset] = true 
      if (!items.get(collection)!.get(v)!.currentSets!.get(modelId)![ilset]) {
        // console.log('Unable to add set to item: ' + ilset + ' ' + v)
        return false
      }
    })
    return true
  } 
  
  function removeItemFromSet(itemId: number, modelId: number, ilset: ILSets) : void {
    const collection = modelStore.getModelCollection(modelId)
    items.get(collection)!.get(itemId)!.currentSets!.get(modelId)![ilset] = false
    setAddedAtMap(modelId, ilset).delete(itemId)
  }
  
  function removeItemsFromSet(itemIds: number[], modelId: number, ilset: ILSets) : boolean {
    const collection = modelStore.getModelCollection(modelId)
    itemIds.forEach((v,_) => {
      items.get(collection)!.get(v)!.currentSets!.get(modelId)![ilset] = false
      if (items.get(collection)!.get(v)!.currentSets!.get(modelId)![ilset]) {
        // console.log('Unable to delete set from item: ' + ilset + ' ' + v)
        return false
      }
    })
    return true
  }
  
  function removeModelFromItems(modelId: number) : void {
    const collection = modelStore.getModelCollection(modelId)
    // The collection has no cache until items from it are loaded
    items.get(collection)?.forEach(item => item.currentSets!.delete(modelId))
  }
  
  function isItemInPos(itemId: number, modelId: number) : boolean {
    const collection = modelStore.getModelCollection(modelId)
    if (!items.has(collection)) return false
    if (!items.get(collection)!.has(itemId)) return false
    if (!items.get(collection)!.get(itemId)!.currentSets!.has(modelId)) return false
    return items.get(collection)!.get(itemId)!.currentSets!.get(modelId)![ILSets.Positives]
  }
  
  function isItemInNeg(itemId: number, modelId: number) : boolean {
    const collection = modelStore.getModelCollection(modelId)
    if (!items.has(collection)) return false
    if (!items.get(collection)!.has(itemId)) return false
    if (!items.get(collection)!.get(itemId)!.currentSets!.has(modelId)) return false
    return items.get(collection)!.get(itemId)!.currentSets!.get(modelId)![ILSets.Negatives]
  }
  
  function isItemInHistory(itemId: number, modelId: number) : boolean {
    const collection = modelStore.getModelCollection(modelId)
    if (!items.has(collection)) return false
    if (!items.get(collection)!.has(itemId)) return false
    if (!items.get(collection)!.get(itemId)!.currentSets!.has(modelId)) return false
    return items.get(collection)!.get(itemId)!.currentSets!.get(modelId)![ILSets.History]
  }
  
  function isItemInSubmitted(itemId: number, modelId: number) : boolean {
    const collection = modelStore.getModelCollection(modelId)
    if (!items.has(collection)) return false
    if (!items.get(collection)!.has(itemId)) return false
    if (!items.get(collection)!.get(itemId)!.currentSets!.has(modelId)) return false
    return items.get(collection)!.get(itemId)!.currentSets!.get(modelId)![ILSets.Submitted]
  }
  
  function getSetItems(modelId: number, set: ILSets): MediaItem[] {
    const collection = modelStore.getModelCollection(modelId)
    
    const colMap = items.get(collection)
    const mItems = modelItems.get(modelId)
    
    if (!colMap || !mItems) return []
    
    const setItems: MediaItem[] = []
    const times = setAddedAtMap(modelId, set)
    
    mItems.forEach((id) => {
      const it = colMap.get(id)
      if (!it) return
      
      const sets = it.currentSets?.get(modelId)
      if (!sets) return
      
      if (sets[set]) {
        if (sets && sets[set] && !times.has(it.id)) times.set(it.id, 0)
        setItems.push(it)
      }
    })
  
    setItems.sort((a, b) => (times.get(b.id) ?? 0) - (times.get(a.id) ?? 0))
    return setItems
  }

  // Item metadata (shot times, Video ID and so on) from /item/info with the item tagsets.
  // It's only fetched on demand for the selected item, a hover preview or a submit.
  async function fetchItemInfo(modelId: number, itemId: number): Promise<Metadata> {
    const collection = modelStore.getModelCollection(modelId)
    const cached = items.get(collection)?.get(itemId)?.metadata
    if (cached) return cached

    const key = `${collection}/${itemId}`
    let p = inflightInfo.get(key)
    if (!p) {
      const filterIds = filterStore.tagsetIds(collection, [...filterStore.mainItemTagsets, ...filterStore.otherItemTagsets])
      p = getItem(appStore.session, itemId, modelId, collection, { filterIds })
        .then(info => {
          const metadata = info.metadata ?? {}
          const colMap = collectionMap(collection)
          const existing = colMap.get(itemId)
          if (existing) existing.metadata = metadata
          else colMap.set(itemId, { ...info, metadata })
          return metadata
        })
        .finally(() => inflightInfo.delete(key))
      inflightInfo.set(key, p)
    }
    return p
  }

  async function fetchRelatedItems(modelId: number, groupId: number): Promise<number[]> {
    const collection = modelStore.getModelCollection(modelId)
    const group = groupStore.get(collection, groupId)!
    if (group.items.length > 0) return group.items

    group.itemsLoaded = false
    try {
      // Ask the server for time order because item IDs aren't guaranteed to follow time
      const [sortBy] = filterStore.tagsetIds(collection, ['Start (ms)', 'Keyframe (ms)'])
      const relatedItems = await getRelatedItems(appStore.session, modelId, groupId, collection, sortBy)
      group.items = relatedItems
      return relatedItems
    } finally {
      // Also on failure, so the grid stops showing a spinner
      group.itemsLoaded = true
    }
  }

  async function setSelectedItem(itemId: number): Promise<void> {
    if (!activeModel.value) return
    const modelId = activeModel.value.id
    const collection = modelStore.getModelCollection(modelId)
    const item = items.get(collection)!.get(itemId)!
    const groupId = item.groupId!

    // Select right away so the viewer opens instantly. The current group is kept only
    // if it's the same video, which then just seeks. Otherwise the viewer shows a
    // placeholder until the new video can start at the right position.
    selectedItem.set(modelId, item)
    selectionFailed.value = false
    if (selectedGroup.get(modelId) !== groupStore.get(collection, groupId)) selectedGroup.delete(modelId)

    // The video needs the group's src and this shot's start time, so fetch both at once
    let group: GroupMetadata
    try {
      [, group] = await Promise.all([
        item.metadata === undefined ? fetchItemInfo(modelId, itemId) : undefined,
        groupStore.fetchGroupInfo(collection, groupId, modelId),
      ])
    } catch (err) {
      if (selectedItem.get(modelId)?.id === itemId) selectionFailed.value = true
      throw err
    }

    // Another item may have been selected while this one was loading
    if (selectedItem.get(modelId)?.id !== itemId) return
    selectedGroup.set(modelId, group)

    // Related IDs fill in reactively once they arrive
    await fetchRelatedItems(modelId, groupId)
  }

  function getSelectedItem() : MediaItem {
    return selectedItem.get(activeModel.value!.id)!
  }
  
  // undefined while a newly selected item's video is still loading
  function getSelectedGroup() : GroupMetadata | undefined {
    return selectedGroup.get(activeModel.value!.id)
  }

  function setAddedAtMap(modelId: number, set: ILSets): Map<number, number> {
    let byModel = setAddedAt.get(modelId)
    if (!byModel) {
      byModel = new Map()
      setAddedAt.set(modelId, byModel)
    }
    let bySet = byModel.get(set)
    if (!bySet) {
      bySet = new Map()
      byModel.set(set, bySet)
    }
    return bySet
  }

  return {
    items, 
    modelItems,
    selectionFailed,
    groupKey,
    fetchMediaItems, 
    addItemToSet, 
    addItemsToSet, 
    removeItemFromSet, 
    removeItemsFromSet, 
    removeModelFromItems,
    isItemInPos,
    isItemInNeg,
    isItemInHistory,
    isItemInSubmitted,
    getSetItems,
    fetchItemInfo,
    fetchRelatedItems,
    setSelectedItem,
    getSelectedGroup,
    getSelectedItem,
  }
})