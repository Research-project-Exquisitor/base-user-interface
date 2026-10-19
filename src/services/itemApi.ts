// SPDX-FileCopyrightText: 2026 Ujjwal Sharma and Omar Shahbaz Khan
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ExqGetItemResponse } from '@/types/exq'
import type MediaItem from '@/types/mediaitem'
import { mock, post } from './http'
import { getItem as mockGetItem, getItemInfoMock } from './MockExquisitorAPI'

export const getItem = async (
    session: string,
    exqId: number,
    modelId: number,
    collection: string,
    opts?: { filterIds?: number[], signal?: AbortSignal }
): Promise<MediaItem> => {
    const filterIds = opts?.filterIds ?? []
    if (mock) {
        const item = await mockGetItem(exqId, modelId)
        if (filterIds.length > 0) item.metadata = await getItemInfoMock(exqId)
        return item
    }
    const sets = new Map<number, boolean[]>()
    sets.set(modelId, [false, false, false, false])
    const resp: ExqGetItemResponse = await post('/exq/item/info', {
        session_info: { session, modelId, collection },
        mediaId: exqId,
        filterIds,
    }, opts?.signal)
    return {
        id: resp.id,
        name: resp.name,
        itemId: resp.mediaId,
        currentSets: sets,
        groupId: resp.groupId,
        mediaType: resp.mediaType,
        thumbPath: resp.thumbPath,
        srcPath: resp.srcPath,
        ...(resp.metadata && { metadata: resp.metadata }),
    }
}

export const getRelatedItems = async (
    session: string,
    model: number,
    mediaId: number,
    collection: string,
    // Tagset ID to order by, such as Start (ms). The server returns them unsorted if omitted
    sortBy?: number,
    sortOrder: 'asc' | 'desc' = 'asc'
): Promise<number[]> => {
    if (mock) return [10, 20, 30, 40, 50]
    const resp: { related: number[] } = await post('/exq/item/related', {
        session_info: { session, modelId: model, collection },
        mediaId,
        ...(sortBy !== undefined && { sortBy, sortOrder }),
    })
    return resp.related
}
