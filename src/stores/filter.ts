// SPDX-FileCopyrightText: 2026 Ujjwal Sharma and Omar Shahbaz Khan
// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  ActiveFiltersDB,
  AppliedFilters,
  DBRangeConstraint,
  FilterExpr,
  FilterGroup,
  FilterInfo,
  FilterLeaf,
  LogicalOp
} from "@/types/filter"
import { defineStore } from "pinia"
import { getFiltersInfo, getFilterValues } from "@/services/ExquisitorAPI"
import { useModelStore } from "./model"

export const useFilterStore = defineStore('filter', () => {
  const filterNameIdMap = reactive(new Map<string, Map<string, number>>())
  const filtersInfo = reactive(new Map<number, FilterInfo[]>())
  const filtersLoaded = ref(false)

  const nonFilterTagsets = [
    //"Start (ms)", "End (ms)",
    "CLIP Index ID",
    "Caption Index ID", "Transcript Index ID"
  ]

  const mainItemTagsets = ["Objects", "Time (hh:mm:ss)", "Video ID", "Hour", "Day", "Month", "Year"]
  const otherItemTagsets = ["Start (ms)", "End (ms)", "Keyframe (ms)"]
  const mainGroupTagsets = ["Title", "Categories", "User Tags"]
  const otherGroupTagsets = ["Resolution", "Duration (hh:mm:ss)"]

  function isMain(key: string) : boolean {
    return mainItemTagsets.includes(key) || mainGroupTagsets.includes(key)
  }

  // Tagset IDs for the given tagset names in a collection, skipping names it doesn't have
  function tagsetIds(collection: string, names: string[]): number[] {
    const nameIds = filterNameIdMap.get(collection)
    if (!nameIds) return []
    return names.map(n => nameIds.get(n)).filter((id): id is number => id !== undefined)
  }

  function isGroup(key: string) : boolean {
    return mainGroupTagsets.includes(key) || otherGroupTagsets.includes(key)
  }

  // Load filters

  // One load per collection, so tabs on the same collection share its filter list and values
  const collectionLoads = new Map<string, Promise<FilterInfo[]>>()

  // A tab's entry is only set once its filters and values are loaded. Callers during a load wait on it
  async function loadFilters(session: string, modelId: number) {
    if (filtersInfo.has(modelId)) return

    const collection = useModelStore().getModelCollection(modelId)
    let load = collectionLoads.get(collection)
    if (!load) {
      load = fetchCollectionFilters(session, collection)
      collectionLoads.set(collection, load)
      // Forget a failed load so the next call tries again
      load.catch(() => {
        if (collectionLoads.get(collection) === load) collectionLoads.delete(collection)
      })
    }
    const list = await load
    // The collection was released while loading, so its last tab is closed
    if (collectionLoads.get(collection) !== load) return
    filtersInfo.set(modelId, list)
    filtersLoaded.value = true
  }

  async function fetchCollectionFilters(session: string, collection: string): Promise<FilterInfo[]> {
    const resp = await getFiltersInfo(session, collection)
    if (!filterNameIdMap.has(collection)) {
      filterNameIdMap.set(collection, new Map<string, number>())
    }
    const nameIds = filterNameIdMap.get(collection)!
    const list: FilterInfo[] = []
    resp.forEach((f) => {
      if (!nameIds.has(f.name)) nameIds.set(f.name, f.id)
      if (!nonFilterTagsets.includes(f.name)
      && !list.find((existingF) => existingF.id === f.id)
      && !f.name.includes('JSON') && !f.name.includes('Index')) {
        list.push(f)
      }
    })
    await Promise.all(list.map(async (f) => {
      f.values = await getFilterValues(session, collection, f.tagtypeId, f.id)
    }))
    return list
  }

  // Drops a closed tab's entry, and the collection's list once no open tab uses it
  function releaseFilters(modelId: number, collection: string) {
    filtersInfo.delete(modelId)
    if (!useModelStore().models.some(m => m.collection === collection)) {
      collectionLoads.delete(collection)
    }
  }

  // Builders

  /**
  * Make a leaf node with value constraint (ANY/ALL semantics)
  */
  function makeValueLeaf(
    id: number,
    tagtype_id: number,
    valueIds: number[],
    operator: LogicalOp = "OR",
    not_: boolean = false
  ): FilterLeaf {
    return {
      kind: "leaf",
      not_,
      filter: {
        id,
        tagtype_id,
        constraint: {
          value_ids: valueIds,
          operator,
        },
      },
    };
  }

  /**
  * Make a leaf node with numeric/string range constraint
  */
  function makeRangeLeaf(
    id: number,
    tagtype_id: number,
    lower: number | string | null = null,
    upper: number | string | null = null,
    not_: boolean = false
  ): FilterLeaf {
    const constraint: DBRangeConstraint = {};
    if (lower !== null && lower !== undefined) constraint.lower_bound = lower;
    if (upper !== null && upper !== undefined) constraint.upper_bound = upper;

    return {
      kind: "leaf",
      not_,
      filter: {
        id,
        tagtype_id,
        constraint,
      },
    };
  }

  /**
  * Make a logical group (AND/OR)
  */
  function makeGroup(
    operator: LogicalOp = "AND",
    children: FilterExpr[] = [],
    not_: boolean = false
  ): FilterGroup {
    return {
      kind: "group",
      operator,
      not_,
      children,
    };
  }

  /**
  * Wrap the root expression into an ActiveFiltersDB object
  */
  function makeActiveFilters(root: FilterExpr): ActiveFiltersDB {
    return { root };
  }

  // (Optional) Type guards:

  // export const isLeaf = (n: FilterExpr): n is FilterLeaf => n.kind === "leaf";
  // export const isGroup = (n: FilterExpr): n is FilterGroup => n.kind === "group";

  function toAppliedFilters(
    af: ActiveFiltersDB | undefined,
    filterInfos: FilterInfo[]
  ): AppliedFilters {
    const out: AppliedFilters = {}
    if (!af) return out

    const byId = new Map<number, FilterInfo>()
    for (const f of filterInfos) byId.set(f.id, f)

    const walk = (expr: FilterExpr) => {
      if (expr.kind === 'leaf') {
        const { id, constraint } = expr.filter
        if ('value_ids' in constraint) {
          const info = byId.get(id)
          if (info) out[id] = info.values.filter(v => (constraint.value_ids as number[]).includes(v.id))
        }
      } else if (expr.kind === 'group') {
        for (const child of (expr as FilterGroup).children) walk(child)
      }
    }
    walk(af.root)
    return out
  }

  return {
    filtersLoaded,
    filtersInfo,
    filterNameIdMap,
    tagsetIds,
    mainItemTagsets,
    otherItemTagsets,
    mainGroupTagsets,
    otherGroupTagsets,
    isMain,
    isGroup,
    loadFilters,
    releaseFilters,
    toAppliedFilters,
    makeValueLeaf,
    makeRangeLeaf,
    makeGroup,
    makeActiveFilters,
  }
})
